document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const settingsButton = document.getElementById('settings-button');

    // Auto-resize textarea
    userInput.addEventListener('input', () => {
        userInput.style.height = 'auto';
        userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';
    });

    function addMessage(text, isUser = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
        messageDiv.textContent = text;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function sendMessage() {
        const message = userInput.value.trim();
        if (!message) return;

        // Disable input while processing
        userInput.disabled = true;
        sendButton.disabled = true;
        
        // Add loading animation to button
        sendButton.innerHTML = '<div class="loading"><span></span><span></span><span></span></div>';

        // Add user message to chat
        addMessage(message, true);
        userInput.value = '';
        userInput.style.height = 'auto';

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'processChat',
                message: message
            });
            
            if (response && response.text) {
                addMessage(response.text, false);
            }
        } catch (error) {
            addMessage('Error: Could not process message', false);
        } finally {
            // Reset button and input
            sendButton.innerHTML = '<i class="fas fa-paper-plane"></i>';
            userInput.disabled = false;
            sendButton.disabled = false;
            userInput.focus();
        }
    }

    sendButton.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    settingsButton.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    // Add welcome message
    addMessage('Hello! Ask me anything about this webpage.', false);
});
