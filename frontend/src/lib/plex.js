
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
    replaceIcons();
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



function replaceIcons(){

    if(!document.querySelector("[title='Education'] [class*='BadgedIcon']")) return setTimeout(replaceIcons, 1000);
//Education
document.querySelector("[title='Education'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"> <title>school-outline</title> <path d="M12 3L1 9L5 11.18V17.18L12 21L19 17.18V11.18L21 10.09V17H23V9L12 3M18.82 9L12 12.72L5.18 9L12 5.28L18.82 9M17 16L12 18.72L7 16V12.27L12 15L17 12.27V16Z" /> </svg>`;

//Audiobooks
document.querySelector("[title='Audiobooks'] [class*='BadgedIcon']").innerHTML = `
<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg">
    <title>book-open-blank-variant-outline</title>
    <path d="M12 21.5C10.65 20.65 8.2 20 6.5 20C4.85 20 3.15 20.3 1.75 21.05C1.65 21.1 1.6 21.1 1.5 21.1C1.25 21.1 1 20.85 1 20.6V6C1.6 5.55 2.25 5.25 3 5C4.11 4.65 5.33 4.5 6.5 4.5C8.45 4.5 10.55 4.9 12 6C13.45 4.9 15.55 4.5 17.5 4.5C18.67 4.5 19.89 4.65 21 5C21.75 5.25 22.4 5.55 23 6V20.6C23 20.85 22.75 21.1 22.5 21.1C22.4 21.1 22.35 21.1 22.25 21.05C20.85 20.3 19.15 20 17.5 20C15.8 20 13.35 20.65 12 21.5M11 7.5C9.64 6.9 7.84 6.5 6.5 6.5C5.3 6.5 4.1 6.65 3 7V18.5C4.1 18.15 5.3 18 6.5 18C7.84 18 9.64 18.4 11 19V7.5M13 19C14.36 18.4 16.16 18 17.5 18C18.7 18 19.9 18.15 21 18.5V7C19.9 6.65 18.7 6.5 17.5 6.5C16.16 6.5 14.36 6.9 13 7.5V19Z" />
</svg>
`;

//Speech
document.querySelector("[title='Speech'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>microphone</title><path d="M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,11C19,14.53 16.39,17.44 13,17.93V21H11V17.93C7.61,17.44 5,14.53 5,11H7A5,5 0 0,0 12,16A5,5 0 0,0 17,11H19Z"/></svg>`;

//Stage
document.querySelector("[title='Stage'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>curtains</title><path d="M23 3H1V1H23V3M2 22H6C6 19 4 17 4 17C10 13 11 4 11 4H2V22M22 4H13C13 4 14 13 20 17C20 17 18 19 18 22H22V4Z"/></svg>`;

//Lectures
document.querySelector("[title='Lectures'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>lectern</title><path d="M17 21V22H7V21H9V11H15V21H17M17.5 6C17.5 4.39 16.41 3.05 14.93 2.64C14.78 2.27 14.43 2 14 2C13.45 2 13 2.45 13 3C13 3.55 13.45 4 14 4C14.31 4 14.58 3.85 14.76 3.63C15.77 3.95 16.5 4.89 16.5 6H4L5 10H19L20 6H17.5Z"/></svg>`;

document.querySelector("[title='Children’s Stories'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>teddy-bear</title><path d="M15.75 19.13C14.92 19.13 14.25 18.29 14.25 17.25C14.25 16.22 14.92 15.38 15.75 15.38C16.58 15.38 17.25 16.22 17.25 17.25C17.25 18.29 16.58 19.13 15.75 19.13M12 11.25C10.76 11.25 9.75 10.41 9.75 9.38C9.75 8.34 10.76 7.5 12 7.5C13.24 7.5 14.25 8.34 14.25 9.38C14.25 10.41 13.24 11.25 12 11.25M8.25 19.13C7.42 19.13 6.75 18.29 6.75 17.25C6.75 16.22 7.42 15.38 8.25 15.38C9.08 15.38 9.75 16.22 9.75 17.25C9.75 18.29 9.08 19.13 8.25 19.13M12 8.25C12.41 8.25 12.75 8.59 12.75 9C12.75 9.41 12.41 9.75 12 9.75C11.59 9.75 11.25 9.41 11.25 9C11.25 8.59 11.59 8.25 12 8.25M18.75 12C18.43 12 18.12 12.07 17.84 12.2C17.36 11.59 16.71 11.07 15.93 10.67C16.5 9.87 16.84 8.9 16.84 7.85C16.84 7.83 16.84 7.81 16.84 7.79C17.93 7.56 18.75 6.59 18.75 5.42C18.75 4.09 17.66 3 16.33 3C15.64 3 15 3.29 14.58 3.75C13.83 3.28 12.95 3 12 3C11.05 3 10.16 3.28 9.42 3.75C9 3.29 8.36 3 7.67 3C6.34 3 5.25 4.09 5.25 5.42C5.25 6.58 6.07 7.55 7.15 7.79C7.15 7.81 7.15 7.83 7.15 7.85C7.15 8.9 7.5 9.88 8.06 10.67C7.29 11.07 6.64 11.59 6.16 12.2C5.88 12.07 5.57 12 5.25 12C4 12 3 13 3 14.25C3 15.5 4 16.5 5.25 16.5C5.27 16.5 5.29 16.5 5.31 16.5C5.27 16.74 5.25 17 5.25 17.25C5.25 19.32 6.59 21 8.25 21C9.26 21 10.15 20.37 10.7 19.41C11.12 19.47 11.55 19.5 12 19.5C12.45 19.5 12.88 19.47 13.3 19.41C13.85 20.37 14.74 21 15.75 21C17.41 21 18.75 19.32 18.75 17.25C18.75 17 18.73 16.74 18.69 16.5C18.71 16.5 18.73 16.5 18.75 16.5C20 16.5 21 15.5 21 14.25C21 13 20 12 18.75 12"/></svg>`;

document.querySelector("[title='Children’s Music'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>music-note</title><path d="M12 3V13.55C11.41 13.21 10.73 13 10 13C7.79 13 6 14.79 6 17S7.79 21 10 21 14 19.21 14 17V7H18V3H12Z"/></svg>`;

document.querySelector("[title='Cooking'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>silverware-fork-knife</title><path d="M11,9H9V2H7V9H5V2H3V9C3,11.12 4.66,12.84 6.75,12.97V22H9.25V12.97C11.34,12.84 13,11.12 13,9V2H11V9M16,6V14H18.5V22H21V2C18.24,2 16,4.24 16,6Z"/></svg>`;

document.querySelector("[title='Sound Effects'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>bullhorn</title><path d="M12,8H4A2,2 0 0,0 2,10V14A2,2 0 0,0 4,16H5V20A1,1 0 0,0 6,21H8A1,1 0 0,0 9,20V16H12L17,20V4L12,8M21.5,12C21.5,13.71 20.54,15.26 19,16V8C20.53,8.75 21.5,10.3 21.5,12Z"/></svg>`;

document.querySelector("[title='Scripture'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>book-cross</title><path d="M5.81,2H7V9L9.5,7.5L12,9V2H18A2,2 0 0,1 20,4V20C20,21.05 19.05,22 18,22H6C4.95,22 4,21.05 4,20V4C4,3 4.83,2.09 5.81,2M13,10V13H10V15H13V20H15V15H18V13H15V10H13Z"/></svg>`;

document.querySelector("[title='Industrial'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>archive-music-outline</title><path d="M21 3H3V9H21V3M19 7H5V5H19V7M18 11V10H20V11H18M14.5 11C14.78 11 15 11.22 15 11.5V13H9V11.5C9 11.22 9.22 11 9.5 11H14.5M13.26 19C13.09 19.47 13 19.97 13 20.5C13 20.67 13 20.84 13.03 21H4V10H6V19H13.26M22 13V15H20V20.5C20 21.88 18.88 23 17.5 23S15 21.88 15 20.5 16.12 18 17.5 18C17.86 18 18.19 18.07 18.5 18.21V13H22Z"/></svg>`;

document.querySelector("[title='Home Video Archive'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>video-vintage</title><path d="M18,14.5V11A1,1 0 0,0 17,10H16C18.24,8.39 18.76,5.27 17.15,3C15.54,0.78 12.42,0.26 10.17,1.87C9.5,2.35 8.96,3 8.6,3.73C6.25,2.28 3.17,3 1.72,5.37C0.28,7.72 1,10.8 3.36,12.25C3.57,12.37 3.78,12.5 4,12.58V21A1,1 0 0,0 5,22H17A1,1 0 0,0 18,21V17.5L22,21.5V10.5L18,14.5M13,4A2,2 0 0,1 15,6A2,2 0 0,1 13,8A2,2 0 0,1 11,6A2,2 0 0,1 13,4M6,6A2,2 0 0,1 8,8A2,2 0 0,1 6,10A2,2 0 0,1 4,8A2,2 0 0,1 6,6Z"/></svg>`;

document.querySelector("[title='Church Videos'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>vhs</title><path d="M4,6A2,2 0 0,0 2,8V16A2,2 0 0,0 4,18H20A2,2 0 0,0 22,16V8A2,2 0 0,0 20,6H4M4.54,10H7V14H4.54C4.19,13.39 4,12.7 4,12C4,11.3 4.19,10.61 4.54,10M9,10H15V14H9V10M17,10H19.46C19.81,10.61 20,11.3 20,12C20,12.7 19.81,13.39 19.46,14H17V10Z"/></svg>`;

document.querySelector("[title='Church Series'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>church-outline</title><path d="M18 12.22V9L13 6.5V5H15V3H13V1H11V3H9V5H11V6.5L6 9V12.22L2 14V22H11V18C11 17.45 11.45 17 12 17C12.55 17 13 17.45 13 18V22H22V14L18 12.22M20 20H15V17.96C15 16.27 13.65 14.9 12 14.9C10.35 14.9 9 16.27 9 17.96V20H4V15.21L8 13.4V10.05L12 8L16 10.04V13.39L20 15.2V20M12 10.5C12.83 10.5 13.5 11.17 13.5 12C13.5 12.83 12.83 13.5 12 13.5C11.17 13.5 10.5 12.83 10.5 12C10.5 11.17 11.17 10.5 12 10.5Z"/></svg>`;

document.querySelector("[title='Documentary Series'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>view-list</title><path d="M9,5V9H21V5M9,19H21V15H9M9,14H21V10H9M4,9H8V5H4M4,19H8V15H4M4,14H8V10H4V14Z"/></svg>`;

document.querySelector("[title='Documentaries'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>movie</title><path d="M18,4L20,8H17L15,4H13L15,8H12L10,4H8L10,8H7L5,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V4H18Z"/></svg>`;

document.querySelector("[title='Ambient'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>spa-outline</title><path d="M15.5,9.63C14.21,10.32 13.03,11.2 12,12.26C10.97,11.19 9.79,10.31 8.5,9.63C8.74,6.86 9.92,4.14 12.06,2C14.18,4.12 15.31,6.84 15.5,9.63M12,15.45C14.15,12.17 17.82,10 22,10C22,20 12.68,21.88 12,22C11.32,21.89 2,20 2,10C6.18,10 9.85,12.17 12,15.45M12.05,5.19C11.39,6.23 10.93,7.38 10.68,8.58L12,9.55L13.35,8.57C13.12,7.37 12.68,6.22 12.05,5.19M12,19.97C12,19.97 18,19 19.74,12.25C14,14 12,19.1 12,19.1C12,19.1 9,13 4.26,12.26C6,19 12,19.97 12,19.97Z"/></svg>`;

document.querySelector("[title='Fitness'] [class*='BadgedIcon']").innerHTML = `<svg aria-hidden="true" class="rkbrtb0 rkbrtb1 rkbrtb3 _1v25wbq6g" fill="currentColor" height="48" viewBox="0 0 24 24" width="48" xmlns="http://www.w3.org/2000/svg"><title>dumbbell</title><path d="M20.57,14.86L22,13.43L20.57,12L17,15.57L8.43,7L12,3.43L10.57,2L9.14,3.43L7.71,2L5.57,4.14L4.14,2.71L2.71,4.14L4.14,5.57L2,7.71L3.43,9.14L2,10.57L3.43,12L7,8.43L15.57,17L12,20.57L13.43,22L14.86,20.57L16.29,22L18.43,19.86L19.86,21.29L21.29,19.86L19.86,18.43L22,16.29L20.57,14.86Z"/></svg>`;

}