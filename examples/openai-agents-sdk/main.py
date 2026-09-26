from agents import ToolCallItem
from saygm_examples_shared import meter_api_calls, model_id, report_fact

# region: setup
import os

from agents import Agent, Runner, function_tool, set_default_openai_client, set_tracing_disabled
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


# region: agent
agent = Agent(
    name="Weather assistant",
    instructions="Answer weather questions. Use the get_weather tool for current conditions.",
    model=model_id("responses_tools"),
    tools=[get_weather],
)

result = Runner.run_sync(agent, "What is the weather in Paris? Should I take an umbrella?")
print(result.final_output)
# endregion

report_fact("tool_calls", sum(isinstance(item, ToolCallItem) for item in result.new_items))
report_fact("answered", bool(result.final_output))
