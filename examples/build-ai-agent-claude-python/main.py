from anthropic.types import ToolUseBlock
from saygm_cookbook_shared import meter_api_calls, model_id, report_fact

# region: setup
import json
import os

import anthropic
from anthropic.types import MessageParam, ToolParam, ToolResultBlockParam

client = anthropic.Anthropic(
    base_url="https://api.saygm.com",
    api_key=os.environ["SAYGM_API_KEY"],
)
model = model_id("claude")
# endregion

meter_api_calls()

# region: tools
tools: list[ToolParam] = [
    {
        "name": "get_weather",
        "description": "Get the current weather for a city.",
        "input_schema": {
            "type": "object",
            "properties": {"city": {"type": "string", "description": "City name, like Paris"}},
            "required": ["city"],
        },
    },
    {
        "name": "convert_temperature",
        "description": "Convert a temperature from Celsius to Fahrenheit.",
        "input_schema": {
            "type": "object",
            "properties": {"celsius": {"type": "number"}},
            "required": ["celsius"],
        },
    },
]


def run_tool(name: str, tool_input: dict) -> str:
    if name == "get_weather":
        return json.dumps({"city": tool_input["city"], "celsius": 18, "conditions": "light rain"})
    if name == "convert_temperature":
        return json.dumps({"fahrenheit": tool_input["celsius"] * 9 / 5 + 32})
    return f"Unknown tool: {name}"


# endregion


# region: loop
def run_agent(question: str, max_turns: int = 6) -> tuple[str, list[MessageParam]]:
    messages: list[MessageParam] = [{"role": "user", "content": question}]
    for _ in range(max_turns):
        response = client.messages.create(
            model=model, max_tokens=1024, tools=tools, messages=messages
        )
        messages.append({"role": "assistant", "content": response.content})
        if response.stop_reason != "tool_use":
            answer = "".join(block.text for block in response.content if block.type == "text")
            return answer, messages
        results: list[ToolResultBlockParam] = [
            {
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": run_tool(block.name, block.input),
            }
            for block in response.content
            if block.type == "tool_use"
        ]
        messages.append({"role": "user", "content": results})
    msg = f"The agent did not finish within {max_turns} turns."
    raise RuntimeError(msg)


answer, transcript = run_agent(
    "What is the weather in Paris, in Fahrenheit? Do I need an umbrella?"
)
print(answer)
# endregion

tool_names = [
    block.name
    for message in transcript
    if message["role"] == "assistant" and isinstance(message["content"], list)
    for block in message["content"]
    if isinstance(block, ToolUseBlock)
]
report_fact("used_weather_tool", "get_weather" in tool_names)
report_fact("used_conversion_tool", "convert_temperature" in tool_names)
report_fact("answered", bool(answer))
