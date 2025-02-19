// Content script for webpage interaction
function getPageContent() {
    return {
        title: document.title,
        content: document.body.innerText,
        url: window.location.href
    };
}

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'getPageContent') {
        sendResponse(getPageContent());
    }
    return true;
}); 