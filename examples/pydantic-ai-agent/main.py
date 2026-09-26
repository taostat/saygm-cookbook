from pydantic_ai.messages import ModelMessage, ToolCallPart
from saygm_examples_shared import meter_api_calls, model_id, report_fact

# region: setup
import os

from pydantic_ai import Agent
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.openai import OpenAIProvider

saygm = OpenAIProvider(base_url="https://api.saygm.com/v1", api_key=os.environ["SAYGM_API_KEY"])
# endregion

meter_api_calls()


def count_tool_calls(messages: list[ModelMessage]) -> int:
    return sum(isinstance(part, ToolCallPart) for message in messages for part in message.parts)


# region: agent
agent = Agent(
    OpenAIChatModel(model_id("chat_cheap"), provider=saygm),
    instructions="Answer weather questions. Use the get_weather tool for current conditions.",
)


@agent.tool_plain
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    return f"{city}: 18 C and light rain"


result = agent.run_sync("What is the weather in Paris? Should I take an umbrella?")
print(result.output)
# endregion

report_fact("tool_calls", count_tool_calls(result.all_messages()))
report_fact("answered", bool(result.output))

# region: claude
claude = AnthropicModel(
    model_id("claude"),
    provider=AnthropicProvider(
        base_url="https://api.saygm.com",
        api_key=os.environ["SAYGM_API_KEY"],
    ),
)

claude_result = agent.run_sync("Is it a good day for a walk in Paris?", model=claude)
print(claude_result.output)
# endregion

report_fact("claude_tool_calls", count_tool_calls(claude_result.all_messages()))
