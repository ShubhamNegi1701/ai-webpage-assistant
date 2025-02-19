document.addEventListener('DOMContentLoaded', async () => {
    // Load existing API key if any
    const result = await chrome.storage.local.get(['apiKey']);
    if (result.apiKey) {
        document.getElementById('api-key').value = result.apiKey;
    }

    // Save API key when button is clicked
    document.getElementById('save').addEventListener('click', async () => {
        const apiKey = document.getElementById('api-key').value.trim();
        if (!apiKey) {
            alert('Please enter a valid API key');
            return;
        }
        await chrome.storage.local.set({ apiKey });
        alert('API key saved!');
    });
}); 