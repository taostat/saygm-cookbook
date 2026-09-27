from pydantic_ai.messages import ModelMessage, ToolCallPart, ToolReturnPart
from saygm_cookbook_shared import meter_api_calls, model_id, report_fact

# region: setup
import asyncio
import os

from pydantic_ai import Agent, RunContext
from pydantic_ai.models import Model
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.run import AgentRunResult
from pydantic_ai.tools import ToolDefinition

import store
from store import Store, open_store

STORE_DOMAIN = os.environ.get("SHOPIFY_STORE_DOMAIN", "allbirds.com")
PROFILE_URL = os.environ.get("UCP_AGENT_PROFILE_URL", store.PINNED_PROFILE_URL)
CREATE_CARTS = os.environ.get("SHOPIFY_CREATE_CART") == "1"

saygm = OpenAIProvider(base_url="https://api.saygm.com/v1", api_key=os.environ["SAYGM_API_KEY"])
# endregion

meter_api_calls()

# region: agent
agent = Agent(
    OpenAIChatModel(model_id("chat_cheap"), provider=saygm),
    deps_type=Store,
    instructions=(
        f"You are the shopping assistant for {STORE_DOMAIN}. Answer from what the tools return: "
        "search the catalog for products, look up a product for sizes and stock, and check the "
        "store's policies for shipping and returns. Look up details only for the product you "
        "recommend. Quote product titles exactly as the tools give them and show prices with "
        "their currency."
    ),
)


@agent.tool
async def search_products(ctx: RunContext[Store], query: str) -> dict:
    """Search the store's catalog by keywords, such as "wool runners" or "rain jacket"."""
    return await store.search_products(ctx.deps, query)


@agent.tool
async def product_details(
    ctx: RunContext[Store], product_id: str, selected: dict[str, str] | None = None
) -> dict:
    """Get a product's variants, prices and stock. selected narrows options, e.g. {"Size": "9"}."""
    return await store.product_details(ctx.deps, product_id, selected)


@agent.tool
async def store_policy(ctx: RunContext[Store], question: str) -> dict:
    """Look up the store's policies and FAQs, such as returns, shipping or care."""
    return await store.store_policy(ctx.deps, question)


# endregion


# region: cart
async def only_when_carts_are_on(
    _ctx: RunContext[Store], tool: ToolDefinition
) -> ToolDefinition | None:
    return tool if CREATE_CARTS else None


@agent.tool(prepare=only_when_carts_are_on)
async def make_cart(ctx: RunContext[Store], variant_ids: list[str]) -> dict:
    """Put one of each product variant in a new cart and return the link to check out."""
    return await store.create_cart(ctx.deps, [(variant, 1) for variant in variant_ids])


# endregion


# region: chat
async def chat(questions: list[str], model: Model | None = None) -> list[AgentRunResult[str]]:
    results = []
    async with open_store(STORE_DOMAIN, PROFILE_URL) as shop:
        for question in questions:
            shop.calls_left = store.CALLS_PER_QUESTION
            result = await agent.run(question, deps=shop, model=model)
            print(f"> {question}\n{result.output}\n")
            results.append(result)
    return results


shoes, returns = asyncio.run(
    chat(
        [
            (
                "I want comfortable shoes for walking. What do you suggest, "
                "and is your top pick in stock?"
            ),
            "What is your return policy?",
        ]
    )
)
# endregion


def tool_calls(messages: list[ModelMessage], name: str | None = None) -> int:
    return sum(
        isinstance(part, ToolCallPart) and name in (None, part.tool_name)
        for message in messages
        for part in message.parts
    )


def searched_titles(messages: list[ModelMessage]) -> list[str]:
    titles = []
    for message in messages:
        for part in message.parts:
            if (
                isinstance(part, ToolReturnPart)
                and part.tool_name == "search_products"
                and isinstance(part.content, dict)
            ):
                titles += [product["title"] for product in part.content.get("products", [])]
    return titles


def normalized(text: str) -> str:
    return text.replace("\N{RIGHT SINGLE QUOTATION MARK}", "'").casefold()


titles = searched_titles(shoes.all_messages())
report_fact("tool_calls", tool_calls(shoes.all_messages()))
report_fact("catalog_titles", len(titles))
report_fact(
    "title_in_answer", any(normalized(title) in normalized(shoes.output) for title in titles)
)
report_fact("policy_tool_calls", tool_calls(returns.all_messages(), "store_policy"))

# region: claude
claude = AnthropicModel(
    model_id("claude"),
    provider=AnthropicProvider(
        base_url="https://api.saygm.com",
        api_key=os.environ["SAYGM_API_KEY"],
    ),
)

[claude_answer] = asyncio.run(chat(["Do you sell socks? Give me one with its price."], claude))
# endregion

report_fact("claude_tool_calls", tool_calls(claude_answer.all_messages()))

if CREATE_CARTS:
    asyncio.run(chat(["Put your best walking shoe in size 9 in a cart and send me the link."]))
