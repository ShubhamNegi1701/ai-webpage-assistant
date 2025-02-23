document.addEventListener('DOMContentLoaded', async () => {
    // Load existing API key if any
    const result = await chrome.storage.local.get(['apiKey']);
    if (result.apiKey) {
        document.getElementById('api-key').value = result.apiKey;
    }

    // Add detailed instructions
    const instructions = document.createElement('div');
    instructions.className = 'instructions';
    instructions.innerHTML = `
        <h3>How to Get Your OpenAI API Key:</h3>
        <ol>
            <li>Visit <a href="https://platform.openai.com/signup" target="_blank">OpenAI's signup page</a></li>
            <li>Create an account or sign in</li>
            <li>Go to <a href="https://platform.openai.com/api-keys" target="_blank">API Keys page</a></li>
            <li>Click "Create new secret key"</li>
            <li>Copy and paste your key here</li>
        </ol>
        <div class="info-box">
            <h4>Important Information:</h4>
            <ul>
                <li>OpenAI offers $5 of free credit for new accounts</li>
                <li>After that, you pay only for what you use (~$0.002 per question)</li>
                <li>You can set usage limits in your OpenAI account</li>
                <li>Your key is stored locally and used only for your requests</li>
            </ul>
            <p>Need help? Visit <a href="https://platform.openai.com/docs/quickstart" target="_blank">OpenAI's Quick Start Guide</a></p>
        </div>
    `;
    document.querySelector('.form-group').appendChild(instructions);

    // Save API key when button is clicked
    document.getElementById('save').addEventListener('click', async () => {
        const apiKey = document.getElementById('api-key').value.trim();
        if (!apiKey) {
            alert('Please enter a valid API key');
            return;
        }
        await chrome.storage.local.set({ apiKey });
        alert('API key saved successfully!');
    });
}); 