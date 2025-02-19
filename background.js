// Add a variable to store the last known page content
let lastPageContent = null;

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'processChat') {
        handleAIChat(request.message, sendResponse);
        return true; // Required for async response
    }
    if (request.type === 'updateContent') {
        lastPageContent = request.content;
        return true;
    }
    if (request.type === 'getSuggestedQuestions') {
        generateSuggestedQuestions(request.pageInfo)
            .then(questions => {
                console.log('Sending questions back to popup:', questions);
                sendResponse({ questions: questions }); // Wrap in an object
            })
            .catch(error => {
                console.error('Error generating questions:', error);
                sendResponse({ 
                    questions: getDefaultQuestions()
                });
            });
        return true;
    }
});

async function getApiKey() {
    const result = await chrome.storage.local.get(['apiKey']);
    return result.apiKey;
}

async function generateSuggestedQuestions(pageInfo) {
    try {
        const apiKey = await getApiKey();
        if (!apiKey) {
            console.log('No API key found');
            return getDefaultQuestions();
        }

        console.log('Sending request to OpenAI...');
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant. Generate 3 questions about the webpage content. Each question must be on a new line and end with a question mark.'
                    },
                    {
                        role: 'user',
                        content: `Generate 3 natural questions about this webpage:
Title: ${pageInfo.title}
Content: ${pageInfo.content.substring(0, 1500)}...`
                    }
                ],
                max_tokens: 150,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            throw new Error('Failed to generate questions');
        }

        const data = await response.json();
        console.log('Raw OpenAI response:', data);

        if (!data?.choices?.[0]?.message?.content) {
            throw new Error('Invalid API response format');
        }

        const text = data.choices[0].message.content;
        
        // More flexible question extraction
        let questions = [];
        
        // Try parsing as JSON first
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                questions = parsed;
            }
        } catch (e) {
            // If not JSON, process as text
            questions = text
                .split('\n')
                .map(q => q.trim())
                .filter(q => q && q.length > 0)
                .map(q => {
                    // Remove any numbering or bullets
                    let cleaned = q.replace(/^\d+[\.\)\-]\s*/, '');
                    // Remove any quotes
                    cleaned = cleaned.replace(/^["']|["']$/g, '');
                    return cleaned.trim();
                })
                .filter(q => q.endsWith('?'));
        }

        // Validate and clean questions
        questions = questions
            .filter(q => typeof q === 'string' && q.trim().length > 0)
            .map(q => q.trim())
            .filter(q => q.endsWith('?'));

        // Ensure we have enough questions
        if (questions.length < 3) {
            questions = [...questions, ...getDefaultQuestions()].slice(0, 3);
        } else {
            questions = questions.slice(0, 3);
        }

        return questions;

    } catch (error) {
        console.error('Error in generateSuggestedQuestions:', error);
        return getDefaultQuestions();
    }
}

function getDefaultQuestions() {
    return [
        "What is this page about?",
        "What are the main topics covered?",
        "Can you summarize the key points?"
    ];
}

function getPageContent() {
    function extractText(element) {
        let text = '';
        if (element.style.display === 'none' || element.style.visibility === 'hidden') {
            return '';
        }

        // Get visible text content
        const isVisible = element.getBoundingClientRect().height > 0;
        if (isVisible && (element.tagName === 'P' || element.tagName === 'H1' || 
            element.tagName === 'H2' || element.tagName === 'H3' || 
            element.tagName === 'LI' || element.tagName === 'TD' ||
            element.tagName === 'DIV' || element.tagName === 'SPAN')) {
            text += ' ' + element.innerText;
        }

        for (const child of element.children) {
            text += ' ' + extractText(child);
        }
        return text;
    }

    const pageContent = {
        title: document.title,
        content: extractText(document.body).replace(/\s+/g, ' ').trim(),
        headings: Array.from(document.querySelectorAll('h1, h2, h3'))
            .map(h => h.innerText.trim())
            .filter(h => h.length > 0)
            .join('\n'),
        links: Array.from(document.querySelectorAll('a'))
            .map(a => ({
                text: a.innerText.trim(),
                href: a.href
            }))
            .filter(link => link.text.length > 0)
            .slice(0, 10)
            .map(link => `${link.text}: ${link.href}`)
            .join('\n'),
        url: window.location.href
    };

    // Update lastPageContent
    lastPageContent = pageContent;

    return pageContent;
}

async function handleAIChat(message, sendResponse) {
    try {
        // Add check for active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            sendResponse({ text: 'No active webpage found. Please try again.' });
            return;
        }

        const apiKey = await getApiKey();
        if (!apiKey) {
            sendResponse({ text: 'Please set up your API key in the extension settings.' });
            return;
        }

        // Inject content script to monitor scrolling
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: () => {
                // Add scroll event listener if not already added
                if (!window._scrollListenerAdded) {
                    window._scrollListenerAdded = true;
                    let scrollTimeout;
                    window.addEventListener('scroll', () => {
                        clearTimeout(scrollTimeout);
                        scrollTimeout = setTimeout(() => {
                            // Update content after scroll stops
                            chrome.runtime.sendMessage({
                                type: 'updateContent',
                                content: window.getPageContent()
                            });
                        }, 500);
                    });
                }
            }
        });

        // Get initial page content
        const [pageInfo] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: getPageContent
        });

        const chatHistory = await chrome.storage.local.get(['chatHistory']) || {};
        const systemPrompt = `
Previous messages:
${chatHistory[tab.id]?.map(msg => `${msg.isUser ? 'User' : 'Assistant'}: ${msg.text}`).join('\n')}

Current webpage: ${pageInfo.result.title}
URL: ${pageInfo.result.url}

Key sections:
${pageInfo.result.headings}

Important links:
${pageInfo.result.links}

Page content:
${pageInfo.result.content.substring(0, 3000)}...

Your task is to answer questions about this webpage's content accurately and concisely. If the answer cannot be found in the page content, say so clearly.`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: message
                    }
                ],
                max_tokens: 500,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            throw new Error('Failed to get a response from the API');
        }

        const data = await response.json();
        console.log('Raw OpenAI response:', data);

        if (!data?.choices?.[0]?.message?.content) {
            throw new Error('Invalid API response format');
        }

        const text = data.choices[0].message.content;
        
        // Improved answer processing
        let processedResponse = text;
        
        // Only try to process if the response contains multiple lines or bullet points
        if (text.includes('\n') || /^\d+[\.\)\-]/.test(text)) {
            const answers = text
                .split('\n')
                .map(a => a.trim())
                .filter(a => a && a.length > 0)
                .map(a => {
                    // Remove any numbering or bullets
                    let cleaned = a.replace(/^\d+[\.\)\-]\s*/, '');
                    // Remove any quotes
                    cleaned = cleaned.replace(/^["']|["']$/g, '');
                    return cleaned.trim();
                });

            if (answers.length > 0) {
                processedResponse = answers.join('\n');
            }
        }

        console.log('Processed response:', processedResponse);
        sendResponse({ text: processedResponse });

    } catch (error) {
        console.error('Error in handleAIChat:', error);
        const errorMessage = error.message === 'Failed to fetch' 
            ? 'Network error. Please check your internet connection.'
            : 'An error occurred. Please try again.';
        sendResponse({ text: errorMessage, error: true });
    }
}

// Add storage for chat history
async function saveChatHistory(tabId, message, isUser) {
    const history = await chrome.storage.local.get(['chatHistory']) || {};
    if (!history[tabId]) history[tabId] = [];
    history[tabId].push({
        text: message,
        isUser,
        timestamp: Date.now()
    });
    await chrome.storage.local.set({ chatHistory: history });
}

// Add support for different modes
const modes = {
    summary: 'Provide brief, concise answers',
    detailed: 'Provide comprehensive explanations',
    academic: 'Use academic language and cite sources',
    simple: 'Explain in simple terms'
};

// Add support for custom instructions
const userPreferences = {
    responseLength: 'short|medium|long',
    language: 'en|es|fr',
    citationStyle: 'apa|mla|chicago'
};

// Add retry logic for API calls
async function fetchWithRetry(url, options, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
        }
    }
}

// Add content sanitization
function sanitizeContent(content) {
    // Remove sensitive data patterns
    return content.replace(/\b\d{16}\b/g, '[REDACTED]')
                 .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]');
}