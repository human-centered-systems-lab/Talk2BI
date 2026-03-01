"""
This module centralizes all LangChain tools used by the agent so they can be
easily reused and extended.
"""

from langchain_core.tools import tool, StructuredTool
from langchain_community.utilities import DuckDuckGoSearchAPIWrapper


__all__ = ["search_DDG", "get_weather", "tools"]


# DuckDuckGo search tool
search_DDG = StructuredTool.from_function(
    name="Search",
    func=DuckDuckGoSearchAPIWrapper().run,
    description="""
    Useful for answering questions about current events.
    Prefer targeted search queries.
    """,
)


@tool
def get_weather(location: str):
    """Return current weather for a given location (mock implementation)."""
    return "It's 90 degrees and sunny."


# List of tools to bind to the model / tool node
tools = [get_weather, search_DDG]
