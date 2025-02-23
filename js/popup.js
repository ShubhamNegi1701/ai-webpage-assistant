document.addEventListener('DOMContentLoaded', async () => {
    // First check if elements exist
    const elements = {
        chatMessages: document.getElementById('chat-messages'),
        userInput: document.getElementById('user-input'),
        sendButton: document.getElementById('send-button'),
        settingsButton: document.getElementById('settings-button'),
        suggestedQuestions: document.getElementById('suggested-questions')
    };

    // Log which elements were found/not found
    console.log('Found elements:', {
        chatMessages: !!elements.chatMessages,
        userInput: !!elements.userInput,
        sendButton: !!elements.sendButton,
        settingsButton: !!elements.settingsButton,
        suggestedQuestions: !!elements.suggestedQuestions
    });

    // Verify all required elements exist
    if (!elements.suggestedQuestions) {
        console.error('Could not find suggested-questions element');
        return;
    }

    // Auto-resize textarea
    elements.userInput.addEventListener('input', () => {
        elements.userInput.style.height = 'auto';
        elements.userInput.style.height = Math.min(elements.userInput.scrollHeight, 100) + 'px';
    });

    function addMessage(text, isUser = false, isError = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
        if (isError) {
            messageDiv.className += ' error-message';
        }
        messageDiv.textContent = text;
        elements.chatMessages.appendChild(messageDiv);
        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }

    async function sendMessage() {
        const message = elements.userInput.value.trim();
        if (!message) return;

        try {
            elements.userInput.disabled = true;
            elements.sendButton.disabled = true;
            elements.sendButton.innerHTML = '<div class="loading"><span></span><span></span><span></span></div>';

            // Add user message to chat
            addMessage(message, true);
            elements.userInput.value = '';
            elements.userInput.style.height = 'auto';

            // Get current tab to use as chat history key
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            // Get existing chat history for this tab
            const result = await chrome.storage.local.get(['chatHistory']);
            const chatHistory = result.chatHistory || {};
            const tabHistory = chatHistory[tab.id] || [];

            // Add user message to history
            tabHistory.push({ text: message, isUser: true });
            chatHistory[tab.id] = tabHistory;
            await chrome.storage.local.set({ chatHistory });

            const response = await chrome.runtime.sendMessage({
                type: 'processChat',
                message: message,
                tabId: tab.id
            });
            
            if (response) {
                const messageText = response.error ? 
                    `Error: ${response.text}` : 
                    response.text || 'No response received';
                
                // Add AI response to history
                if (!response.error) {
                    tabHistory.push({ text: messageText, isUser: false });
                    chatHistory[tab.id] = tabHistory;
                    await chrome.storage.local.set({ chatHistory });
                }
                
                addMessage(messageText, false, response.error);
            } else {
                addMessage('Error: No response received', false, true);
            }

        } catch (error) {
            console.error('Message send error:', error);
            addMessage('Error: Failed to send message', false, true);
        } finally {
            elements.sendButton.innerHTML = '<i class="fas fa-paper-plane"></i>';
            elements.userInput.disabled = false;
            elements.sendButton.disabled = false;
            elements.userInput.focus();
        }
    }

    elements.sendButton.addEventListener('click', () => sendMessage());
    elements.userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    elements.settingsButton.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    // Function to get page content
    async function getPageContent() {
        console.log('Getting page content...');
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                throw new Error('No active tab found');
            }

            // Check if we can access the tab
            if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
                throw new Error('Cannot access this type of page. Please try on a regular webpage.');
            }

            // First try using Manifest V3 approach
            if (chrome.scripting) {
                console.log('Using chrome.scripting API...');
                try {
                    const [pageInfo] = await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        function: () => ({
                            title: document.title,
                            content: document.body.innerText,
                            url: window.location.href
                        })
                    });
                    
                    if (!pageInfo?.result) {
                        throw new Error('Could not extract page content');
                    }
                    
                    console.log('Page content retrieved successfully');
                    return pageInfo.result;
                } catch (scriptError) {
                    console.error('Script execution failed:', scriptError);
                    throw new Error('Cannot access page content. Please check if the page has finished loading.');
                }
            }

            // Fallback to Manifest V2 approach
            console.log('Falling back to tabs.executeScript...');
            return new Promise((resolve, reject) => {
                chrome.tabs.executeScript(tab.id, {
                    code: `({
                        title: document.title,
                        content: document.body.innerText,
                        url: window.location.href
                    })`
                }, (result) => {
                    if (chrome.runtime.lastError) {
                        console.error('Execute script error:', chrome.runtime.lastError);
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (!result?.[0]) {
                        reject(new Error('No content retrieved'));
                        return;
                    }
                    console.log('Page content retrieved successfully');
                    resolve(result[0]);
                });
            });
        } catch (error) {
            console.error('Failed to get page content:', error);
            addMessage(`Error: ${error.message}`, false, true);
            return null;
        }
    }

    // Add this function before loadSuggestedQuestions
    function updateSuggestedQuestionsUI(questions) {
        const suggestedQuestionsDiv = document.getElementById('suggested-questions');
        if (!suggestedQuestionsDiv) {
            console.error('Could not find suggested-questions element');
            return;
        }

        // Clear existing questions
        suggestedQuestionsDiv.innerHTML = '';

        // Add each question as a button
        questions.forEach(question => {
            const button = document.createElement('button');
            button.className = 'question-btn';
            button.textContent = question;
            
            // Add click handler to automatically send the question
            button.addEventListener('click', async () => {
                // Disable all question buttons to prevent double-clicking
                const allButtons = suggestedQuestionsDiv.querySelectorAll('.question-btn');
                allButtons.forEach(btn => btn.disabled = true);
                
                // Set the question in input and trigger send
                const userInput = document.getElementById('user-input');
                if (userInput) {
                    userInput.value = question;
                    userInput.dispatchEvent(new Event('input')); // Trigger auto-resize
                    await sendMessage(); // Send the message
                    
                    // Clear suggested questions after sending
                    suggestedQuestionsDiv.style.display = 'none';
                    
                    // Focus back on input for follow-up questions
                    userInput.value = '';
                    userInput.focus();
                }
            });

            suggestedQuestionsDiv.appendChild(button);
        });
    }

    function getDefaultQuestions() {
        return [
            "What is this page about?",
            "What are the main topics covered?",
            "Can you summarize the key points?"
        ];
    }

    // Function to load suggested questions
    async function loadSuggestedQuestions() {
        console.log('Loading suggested questions...');
        try {
            const pageInfo = await getPageContent();
            if (!pageInfo?.content) {
                throw new Error('Invalid page content');
            }

            elements.suggestedQuestions.innerHTML = `
                <button class="question-btn loading-btn" disabled>
                    Generating questions...
                </button>
            `;

            const response = await chrome.runtime.sendMessage({
                type: 'getSuggestedQuestions',
                pageInfo
            });

            // More flexible response handling
            let questions = [];
            
            if (response?.questions && Array.isArray(response.questions)) {
                questions = response.questions
                    .filter(q => typeof q === 'string' && q.trim().length > 0)
                    .map(q => q.trim());
            }

            // Use defaults if no valid questions
            if (questions.length < 1) {
                questions = getDefaultQuestions();
            }

            // Update UI with questions
            updateSuggestedQuestionsUI(questions);

        } catch (error) {
            console.error('Error loading questions:', error);
            // Don't show error message here since getPageContent already shows it
            updateSuggestedQuestionsUI(getDefaultQuestions());
        }
    }

    // Load existing chat history when popup opens
    async function loadChatHistory() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const result = await chrome.storage.local.get(['chatHistory']);
            const chatHistory = result.chatHistory || {};
            const tabHistory = chatHistory[tab.id] || [];
            
            // Add existing messages to chat
            tabHistory.forEach(msg => {
                addMessage(msg.text, msg.isUser);
            });
        } catch (error) {
            console.error('Error loading chat history:', error);
        }
    }

    // Load chat history when popup opens
    await loadChatHistory();

    // Load suggested questions when popup opens
    console.log('Starting to load questions...');
    await loadSuggestedQuestions();
    console.log('Finished loading questions');

    // Add welcome message
    addMessage('Hello! Ask me anything about this webpage, or try one of the suggested questions below.', false);
});

// Update global error handling to not suppress errors
window.onerror = function(message, source, lineno, colno, error) {
    console.error('Global error:', {message, source, lineno, colno, error});
    // Don't return false to allow default error handling
};

// Improve error boundary with null check and error logging
function handleError(error) {
    console.error('Application error:', error);
    
    const chatContainer = document.querySelector('.chat-container');
    if (!chatContainer) {
        console.error('Chat container not found while handling error');
        return;
    }
    
    chatContainer.innerHTML = `
        <div class="error-message">
            <p>Something went wrong. Please try refreshing.</p>
            <button onclick="location.reload()">Refresh</button>
        </div>
    `;
}
