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
});

async function getApiKey() {
    const result = await chrome.storage.local.get(['apiKey']);
    return result.apiKey;
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

        const systemPrompt = `You are a helpful AI assistant analyzing a webpage.

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
                max_tokens: 250,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'API request failed');
        }

        const data = await response.json();
        sendResponse({ 
            text: data.choices[0].message.content 
        });
    } catch (error) {
        sendResponse({ 
            text: `Error: ${error.message || 'There was an error processing your request.'}` 
        });
    }
}
