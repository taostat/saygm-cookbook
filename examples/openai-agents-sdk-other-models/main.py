from agents import RunResult, ToolCallItem
from saygm_cookbook_shared import meter_api_calls, model_id, report_fact

# region: setup
import os

from agents import (
    Agent,
    OpenAIChatCompletionsModel,
    Runner,
    function_tool,
    set_default_openai_client,
    set_tracing_disabled,
)
from openai import AsyncOpenAI

client = AsyncOpenAI(base_url="https://api.saygm.com/v1", api_key=os.environ["SAYGM_API_KEY"])
set_default_openai_client(client, use_for_tracing=False)
set_tracing_disabled(disabled=True)
# endregion

meter_api_calls()


# region: tool
@function_tool
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    return f"{city}: 18 C and light rain"


# endregion

# region: gpt-agent
gpt_agent = Agent(
    name="Weather assistant on GPT",
    instructions="Answer weather questions. Use the get_weather tool for current conditions.",
    model=model_id("responses_tools"),
    tools=[get_weather],
)
# endregion

# region: open-model-agent
open_agent = Agent(
    name="Weather assistant on an open model",
    instructions="Answer weather questions. Use the get_weather tool for current conditions.",
    model=OpenAIChatCompletionsModel(model=model_id("chat_cheap"), openai_client=client),
    tools=[get_weather],
)
# endregion

# region: run-agents
question = "What is the weather in Paris? Should I take an umbrella?"

gpt_result = Runner.run_sync(gpt_agent, question)
print(f"GPT: {gpt_result.final_output}")

open_result = Runner.run_sync(open_agent, question)
print(f"Open model: {open_result.final_output}")
# endregion


def tool_calls(result: RunResult) -> int:
    return sum(isinstance(item, ToolCallItem) for item in result.new_items)


report_fact("gpt_tool_calls", tool_calls(gpt_result))
report_fact("open_model_tool_calls", tool_calls(open_result))
report_fact("both_answered", bool(gpt_result.final_output) and bool(open_result.final_output))
