/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} - True if copy was successful
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy:', err);
    return false;
  }
}

/**
 * Add copy buttons to all code blocks
 * @param {HTMLElement} container - Container element with code blocks (default: document)
 * @param {Object} options - Configuration options
 * @param {string} options.buttonText - Text for copy button (default: 'Copy')
 * @param {string} options.successText - Text after successful copy (default: 'Copied!')
 * @param {number} options.successDuration - Duration to show success text in ms (default: 2000)
 */
export function addCopyButtonsToCodeBlocks(container = document, options = {}) {
  const {
    buttonText = 'Copy',
    successText = 'Copied!',
    successDuration = 2000,
  } = options;

  const codeBlocks = container.querySelectorAll('pre');

  codeBlocks.forEach((pre) => {
    // Ensure pre has position relative for absolute positioning
    pre.style.position = 'relative';

    const button = document.createElement('button');
    button.textContent = buttonText;
    button.className = 'copy-btn';
    button.setAttribute('aria-label', 'Copy code');

    button.onclick = async () => {
      const codeElement = pre.querySelector('code') || pre;
      const text = codeElement.textContent.trim();
      const success = await copyToClipboard(text);
      if (success) {
        button.textContent = successText;
        setTimeout(() => {
          button.textContent = buttonText;
        }, successDuration);
      }
    };

    // Add button directly to pre element
    pre.appendChild(button);
  });
}
