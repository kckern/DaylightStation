
function extractMetadataKey(url) {
    // Locate the fragment part starting with '#!' and decode it
    const hashIndex = url.indexOf('#!');
    if (hashIndex < 0) {
        return null; // No hash fragment
    }
    
    const fragment = url.substring(hashIndex + 2); // Skip '#!' part
    const decodedFragment = decodeURIComponent(fragment);

    // Use regex to match the metadata key from the decoded URL fragment
    const regex = /\/(metadata|playlists|collections)\/(\d+)/; // Matches "/metadata/" followed by digits
    const match = decodedFragment.match(regex);

    // Return the first capturing group from the match if available
    return match ? match[2] : null;
}

// Function to create and inject the metadata key <div>
function createOrUpdateMetadataDiv() {
    const metadataKey = extractMetadataKey(window.location.href);

    if (!metadataKey) {
        return;
    }

    // Check if the div already exists
    let metadataDiv = document.getElementById('metadata-key-div');
    if (!metadataDiv) {
        // Create a new div element if it does not exist
        metadataDiv = document.createElement('div');
        metadataDiv.id = 'metadata-key-div';

        // Set initial styles for the div
       // metadataDiv.style.position = 'absolute';
       // metadataDiv.style.top = '10px';
       // metadataDiv.style.right = '10px';
        metadataDiv.style.color = '#EEE';
        metadataDiv.style.fontFamily = 'monospace';
        metadataDiv.style.padding = '10px';
        metadataDiv.style.cursor = 'pointer';
        //metadataDiv.style.border = '1px solid #ccc';
        metadataDiv.style.zIndex = 1000;
        // Append the div as a child of the div with class starting with 'NavBar-container'
        const navBarContainer = document.querySelector('[class^="NavBar-container"]');
        if (navBarContainer) {
            navBarContainer.appendChild(metadataDiv);
        } else {
            console.warn("NavBar-container* not found. Appending metadataDiv to body as fallback.");
            document.body.appendChild(metadataDiv);
        }

            // Add an event listener to make the div vanish on right-click
            metadataDiv.addEventListener('contextmenu', (event) => {
                event.preventDefault(); // Prevent the default context menu
                metadataDiv.style.display = 'none'; // Hide the div
            });

            // Add an event listener to copy the content to clipboard on click
            metadataDiv.addEventListener('click', () => {
                // Copy the metadata key to the clipboard
                navigator.clipboard.writeText(metadataDiv.innerText).then(() => {
                // Flash the div to indicate successful copy
                metadataDiv.style.backgroundColor = '#FFFFFF'; // Change background color
                metadataDiv.style.color = '#000000'; // Change background color

                setTimeout(() => {
                    metadataDiv.style.backgroundColor = ''; // Reset background color
                    metadataDiv.style.color = '#EEE'; // Reset text color
                }, 300);
                }).catch((err) => {
                console.error('Failed to copy text: ', err);
                });
            });

            // Prevent text selection inside the div
            metadataDiv.style.userSelect = 'none';
    }

    // Update the content of the div to the current metadata key
    metadataDiv.innerText = `${metadataKey}`;
}

// Detect URL changes on a single-page application
function onUrlChange(callback) {
    let lastUrl = window.location.href;

    // Use MutationObserver to detect changes in the DOM that might indicate a URL change
    const observer = new MutationObserver(() => {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            callback();
        }
    });

    // Start observing the document or a specific element that changes with navigation
    observer.observe(document, { subtree: true, childList: true });

    // Add popstate listener for history navigation
    window.addEventListener('popstate', () => {
        callback();
    });

    // Initial invocation
    callback();
}

// Wait until the NavBar-container exists before running onUrlChange
const waitForNavBar = setInterval(() => {
    const navBarContainer = document.querySelector('[class^="NavBar-container"]');
    if (navBarContainer) {
        clearInterval(waitForNavBar);
        // Run the onUrlChange function and pass createOrUpdateMetadataDiv as the callback
        onUrlChange(createOrUpdateMetadataDiv);
    }
}, 100); // Check every 100ms

