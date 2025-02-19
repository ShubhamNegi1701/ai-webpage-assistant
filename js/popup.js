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

    function addMessage(text, isUser = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
        messageDiv.textContent = text;
        elements.chatMessages.appendChild(messageDiv);
        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }

    async function sendMessage() {
        const message = elements.userInput.value.trim();
        if (!message) return;

        // Disable input while processing
        elements.userInput.disabled = true;
        elements.sendButton.disabled = true;
        
        // Add loading animation to button
        elements.sendButton.innerHTML = '<div class="loading"><span></span><span></span><span></span></div>';

        // Add user message to chat
        addMessage(message, true);
        elements.userInput.value = '';
        elements.userInput.style.height = 'auto';

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
            elements.sendButton.innerHTML = '<i class="fas fa-paper-plane"></i>';
            elements.userInput.disabled = false;
            elements.sendButton.disabled = false;
            elements.userInput.focus();
        }
    }

    elements.sendButton.addEventListener('click', sendMessage);
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
                        throw new Error('Failed to get page content');
                    }
                    
                    console.log('Page content retrieved successfully');
                    return pageInfo.result;
                } catch (scriptError) {
                    console.error('Script execution failed:', scriptError);
                    throw new Error('Failed to execute content script');
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
            throw error; // Re-throw to be handled by caller
        }
    }

    // Function to load suggested questions
    async function loadSuggestedQuestions() {
        console.log('Loading suggested questions...');
        try {
            const pageInfo = await getPageContent();
            if (!pageInfo) {
                throw new Error('No page info available');
            }

            elements.suggestedQuestions.innerHTML = `
                <button class="question-btn loading-btn" disabled>
                    Generating questions...
                </button>
            `;

            console.log('Requesting questions from background...');
            const response = await chrome.runtime.sendMessage({
                type: 'getSuggestedQuestions',
                pageInfo
            });

            console.log('Received response:', response);

            // Add more robust response validation
            if (!response) {
                throw new Error('Empty response received');
            }

            let questions = [];
            if (Array.isArray(response.questions)) {
                questions = response.questions;
            } else if (typeof response.questions === 'string') {
                // Try to parse as JSON if it's a string
                try {
                    const parsed = JSON.parse(response.questions);
                    questions = Array.isArray(parsed) ? parsed : [parsed];
                } catch (parseError) {
                    // If JSON parsing fails, try splitting by newlines and cleaning up
                    questions = response.questions
                        .split(/[\n\r]+/)
                        .map(q => q.trim())
                        .filter(q => q && q.length > 0)
                        .map(q => q.replace(/^[-*\d.)\s]+/, '')); // Remove leading bullets/numbers
                }
            }

            // Validate questions and use defaults if necessary
            if (!questions.length) {
                throw new Error('No valid questions found in response');
            }

            // Sanitize questions to prevent XSS
            const sanitizeText = (text) => {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            };

            elements.suggestedQuestions.innerHTML = questions
                .map(question => `
                    <button class="question-btn">${sanitizeText(question)}</button>
                `).join('');
            
            // Add click handlers for the question buttons
            const questionButtons = elements.suggestedQuestions.querySelectorAll('.question-btn');
            questionButtons.forEach(button => {
                button.addEventListener('click', async () => {
                    // Set the question text in the input
                    elements.userInput.value = button.textContent.trim();
                    
                    // Fade out all question buttons except the clicked one
                    questionButtons.forEach(btn => {
                        if (btn !== button) {
                            btn.style.opacity = '0';
                            btn.style.transform = 'translateY(5px)';
                        }
                    });
                    
                    // Highlight the selected question briefly
                    button.style.backgroundColor = '#007bff';
                    button.style.color = 'white';
                    
                    // Small delay before sending to show the selection
                    await new Promise(resolve => setTimeout(resolve, 150));
                    
                    // Hide the suggested questions container
                    elements.suggestedQuestions.style.opacity = '0';
                    elements.suggestedQuestions.style.transform = 'translateY(10px)';
                    
                    // After animation, remove from layout
                    setTimeout(() => {
                        elements.suggestedQuestions.style.display = 'none';
                        elements.chatMessages.style.flex = '1';
                    }, 300);
                    
                    // Trigger the send message
                    sendMessage();
                });
            });

            console.log('Questions loaded successfully');
        } catch (error) {
            console.error('Error loading questions:', error);
            elements.suggestedQuestions.innerHTML = `
                <button class="question-btn">What is this page about?</button>
                <button class="question-btn">What are the main topics covered?</button>
                <button class="question-btn">Can you summarize the key points?</button>
            `;
        }
    }

    // Load suggested questions when popup opens
    console.log('Starting to load questions...');
    await loadSuggestedQuestions();
    console.log('Finished loading questions');

    // Add welcome message
    addMessage('Hello! Ask me anything about this webpage, or try one of the suggested questions below.', false);
});
