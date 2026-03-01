# Talk2BI

Enabling Natural Language Access to Business Intelligence. Built using LangGraph and Streamlit. An open-access initiative by the Human-Centered Systems Lab (h-Lab), Karlsruhe Institute of Technology (KIT), Germany.

## Get started

1. Install uv: https://docs.astral.sh/uv/getting-started/installation/

2. Install packages 
``` bash 
uv sync
```

3. Create .env file

```bash
# Create the .env
cp .env.example .env
```

4. Replace placeholders in the .env file

``` bash 
OPENAI_API_KEY = ...
...
```

5. Run the application

``` bash
cd src
uv run streamlit run streamlit_app.py
```