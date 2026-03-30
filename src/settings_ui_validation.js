// ADD TO settings.html - JavaScript for validation and error display

// Call this before saving a sync rule
async function validateRule(ruleData) {
  try {
    const response = await fetch('/settings/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portalId: PORTAL_ID,
        sourceObject: ruleData.sourceObject,
        targetObject: ruleData.targetObject,
        mappings: ruleData.mappings
      })
    });
    
    const validation = await response.json();
    return validation;
  } catch (err) {
    console.error('Validation error:', err);
    return { valid: false, errors: [{ message: 'Validation failed' }] };
  }
}

// Show validation errors to user
function showValidationErrors(validation) {
  const errorContainer = document.getElementById('validation-errors');
  
  if (!validation.valid && validation.errors.length > 0) {
    const errorHtml = validation.errors.map(err => {
      let errorClass = 'error-permission';
      let icon = '🚫';
      
      if (err.type === 'custom_object_unavailable') {
        errorClass = 'error-tier';
        icon = '⬆️';
      } else if (err.type === 'property_not_found') {
        errorClass = 'error-config';
        icon = '⚠️';
      }
      
      return `
        <div class="validation-error ${errorClass}">
          <span class="error-icon">${icon}</span>
          <div class="error-content">
            <strong>${err.field ? err.field.toUpperCase() : 'ERROR'}</strong>
            <p>${err.message}</p>
          </div>
        </div>
      `;
    }).join('');
    
    errorContainer.innerHTML = errorHtml;
    errorContainer.style.display = 'block';
    return false;
  }
  
  // Show warnings if any
  if (validation.warnings && validation.warnings.length > 0) {
    const warningHtml = validation.warnings.map(warn => `
      <div class="validation-warning">
        <span class="warning-icon">⚠️</span>
        <p>${warn.message}</p>
      </div>
    `).join('');
    
    errorContainer.innerHTML = warningHtml;
    errorContainer.style.display = 'block';
  } else {
    errorContainer.style.display = 'none';
  }
  
  return true;
}

// Modify your save rule function
async function saveRule(ruleData) {
  // Clear previous errors
  const errorContainer = document.getElementById('validation-errors');
  errorContainer.style.display = 'none';
  
  // Validate first
  const validation = await validateRule(ruleData);
  
  if (!validation.valid) {
    showValidationErrors(validation);
    return;
  }
  
  // If valid, proceed with save
  try {
    const response = await fetch('/settings/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portalId: PORTAL_ID, ...ruleData })
    });
    
    if (response.ok) {
      // Success handling
      loadRules();
      closeModal();
    } else {
      const error = await response.json();
      showError(error.message || 'Failed to save rule');
    }
  } catch (err) {
    showError('Network error: ' + err.message);
  }
}

// Also add real-time validation on object selection
document.getElementById('sourceObject').addEventListener('change', async (e) => {
  const sourceObject = e.target.value;
  const targetObject = document.getElementById('targetObject').value;
  
  if (sourceObject && targetObject) {
    const validation = await validateRule({ sourceObject, targetObject, mappings: [] });
    showValidationErrors(validation);
  }
});

document.getElementById('targetObject').addEventListener('change', async (e) => {
  const sourceObject = document.getElementById('sourceObject').value;
  const targetObject = e.target.value;
  
  if (sourceObject && targetObject) {
    const validation = await validateRule({ sourceObject, targetObject, mappings: [] });
    showValidationErrors(validation);
  }
});
