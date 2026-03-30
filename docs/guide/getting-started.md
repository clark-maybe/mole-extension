# Get Started

Get Mole running in under 5 minutes.

## Step 1: Install the Extension

1. Go to the [Download](/download) page and download the latest release
2. Unzip the downloaded file
3. Open `chrome://extensions/` in Chrome
4. Enable **Developer Mode** (top right corner)
5. Click **Load unpacked** and select the unzipped folder
6. Pin Mole to your toolbar for easy access

::: tip Want to build from source?
See the [Development Guide](/guide/development) for instructions on building from the repository.
:::

## Step 2: Connect an AI Model

Mole needs an AI service to do its thinking. Set it up once and you're good to go.

1. Right-click the Mole icon in your toolbar, select **Options**
2. Fill in your AI service details:
   - **API Endpoint** — e.g. `https://api.openai.com/v1`
   - **API Key** — your API key
   - **Model** — e.g. `gpt-4o-mini` or `gpt-4o`
3. Click **Save**

::: details Which AI services work?
Any service that supports the OpenAI API format and **Function Calling** (tool use):

- **OpenAI** — `https://api.openai.com/v1`
- **Azure OpenAI** — your Azure endpoint
- **Claude** — via OpenAI-compatible proxy
- **Ollama** (local) — `http://localhost:11434/v1`
- **LM Studio** (local) — `http://localhost:1234/v1`
- Any other OpenAI-compatible service
:::

## Step 3: Try It Out

Visit any webpage and press `Cmd+M` (Mac) or `Ctrl+M` (Windows).

Try typing:
- "What is this page about?"
- "Take a screenshot"
- "Search for iPhone 16 on Amazon and show me the top 5 results"

Mole works in the background and brings you the results.

## Next Steps

- [Your First Task](/guide/first-task) — A guided walkthrough
- [What Can Mole Do?](/guide/examples) — Browse use cases and examples
- [Record a Workflow](/guide/workflows) — Teach Mole to repeat tasks for you
- [Configuration Details](/guide/configuration) — Advanced settings
