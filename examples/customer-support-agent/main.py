from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from saygm_cookbook_shared import meter_api_calls, model_id, report_fact

# region: setup
import json
import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel
from pydantic_ai import Agent, AgentRunResult, RunContext
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.openai import OpenAIProvider

api_key = os.environ["SAYGM_API_KEY"]
open_model = OpenAIChatModel(
    model_id("chat_cheap"),
    provider=OpenAIProvider(base_url="https://api.saygm.com/v1", api_key=api_key),
)
claude = AnthropicModel(
    model_id("claude"),
    provider=AnthropicProvider(base_url="https://api.saygm.com", api_key=api_key),
)
# endregion

meter_api_calls()

# region: data
DATA = Path(__file__).parent
ORDERS = {order["order_id"]: order for order in json.loads((DATA / "orders.json").read_text())}
FAQ = json.loads((DATA / "faq.json").read_text())
# endregion


# region: agent
class Reply(BaseModel):
    answer: str
    intent: Literal["order_status", "policy", "refund", "other"]
    confident: bool


agent = Agent(
    open_model,
    deps_type=str,
    output_type=Reply,
    instructions=(
        "You are a support agent for an online shop. Use the tools for order and policy facts. "
        "Set intent to refund when the customer asks for money back. "
        "Set confident to false when the tools do not answer the question."
    ),
)


@agent.tool
def lookup_order(ctx: RunContext[str], order_id: str) -> str:
    """Look up one of the signed-in customer's orders by its number."""
    order = ORDERS.get(order_id)
    if order is None or order["email"] != ctx.deps:
        return "The signed-in customer has no order with that number."
    return json.dumps(order)


@agent.tool_plain
def search_faq(topic: str) -> str:
    """Find shop policy by topic: shipping, returns or refunds."""
    matches = [entry for entry in FAQ if topic.lower() in entry["topic"]]
    return json.dumps(matches or FAQ)


# endregion


# region: escalate
def answer(question: str, customer_email: str) -> tuple[AgentRunResult[Reply], bool]:
    result = agent.run_sync(question, deps=customer_email)
    escalate = result.output.intent == "refund" or not result.output.confident
    if escalate:
        result = agent.run_sync(question, deps=customer_email, model=claude)
    return result, escalate


# endregion

# region: questions
routine, routine_escalated = answer("Where is order 1001?", customer_email="ana@example.com")
print(f"Open model: {routine.output.answer}")

refund, refund_escalated = answer(
    "My mug set from order 1002 arrived broken. I want a refund.",
    customer_email="sam@example.com",
)
print(f"Claude: {refund.output.answer}")
# endregion


SHOP_TOOLS = {"lookup_order", "search_faq"}


def tool_calls(messages: list[ModelMessage]) -> int:
    parts = [part for message in messages for part in message.parts]
    return sum(isinstance(part, ToolCallPart) and part.tool_name in SHOP_TOOLS for part in parts)


def answered_by(messages: list[ModelMessage]) -> str:
    responses = [message for message in messages if isinstance(message, ModelResponse)]
    return responses[-1].model_name or "" if responses else ""


report_fact("routine_escalated", routine_escalated)
report_fact("routine_tool_calls", tool_calls(routine.all_messages()))
report_fact("refund_escalated", refund_escalated)
report_fact("refund_answered_by_claude", answered_by(refund.all_messages()).startswith("claude"))
