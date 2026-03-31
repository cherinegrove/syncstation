// src/public/js/fieldTypeValidation.js
// Client-side field type validation helper for PropBridge settings page

/**
 * Field Type Compatibility (matches server-side logic)
 */
const COMPATIBILITY_MAP = {
  'string': ['string', 'enumeration', 'textarea', 'phonenumber', 'email'],
  'textarea': ['string', 'textarea'],
  'number': ['number'],
  'date': ['date', 'datetime'],
  'datetime': ['date', 'datetime'],
  'enumeration': ['enumeration', 'string', 'textarea'],
  'bool': ['bool'],
  'phonenumber': ['phonenumber', 'string'],
  'email': ['email', 'string'],
  'multiselect': ['multiselect', 'textarea'],
  'file': ['file'],  // File to file only
};

/**
 * Get compatible target types for a source type
 */
function getCompatibleTypes(sourceType) {
  return COMPATIBILITY_MAP[sourceType] || [sourceType];
}

/**
 * Check if two types are compatible
 */
function areTypesCompatible(sourceType, targetType) {
  if (sourceType === targetType) return true;
  const compatible = COMPATIBILITY_MAP[sourceType];
  return compatible ? compatible.includes(targetType) : false;
}

/**
 * Get user-friendly type name
 */
function getTypeName(type) {
  const typeNames = {
    'string': 'Single-line text',
    'textarea': 'Multi-line text',
    'number': 'Number',
    'date': 'Date',
    'datetime': 'Date and time',
    'enumeration': 'Dropdown',
    'bool': 'Checkbox',
    'phonenumber': 'Phone number',
    'email': 'Email',
    'multiselect': 'Multiple checkboxes',
    'file': 'File'
  };
  return typeNames[type] || type;
}

/**
 * Filter properties by compatibility with source type
 * @param {Array} allProperties - All available properties
 * @param {string} sourceType - The source property type
 * @returns {Array} Filtered properties that are compatible
 */
function filterCompatibleProperties(allProperties, sourceType) {
  if (!sourceType || !allProperties) return allProperties;
  
  const compatibleTypes = getCompatibleTypes(sourceType);
  
  return allProperties.filter(prop => 
    compatibleTypes.includes(prop.type)
  );
}

/**
 * Show field type hint to user
 * @param {HTMLElement} container - Container element to show hint in
 * @param {string} sourceType - Selected source property type
 * @param {string} sourceName - Selected source property name
 */
function showTypeHint(container, sourceType, sourceName) {
  if (!container || !sourceType) return;
  
  const compatibleTypes = getCompatibleTypes(sourceType);
  const typeNames = compatibleTypes.map(getTypeName).join(', ');
  
  container.innerHTML = `
    <div class="type-hint">
      <i class="hint-icon">ℹ️</i>
      <strong>${sourceName}</strong> is type: <strong>${getTypeName(sourceType)}</strong><br>
      Compatible target types: <strong>${typeNames}</strong>
    </div>
  `;
  container.style.display = 'block';
}

/**
 * Validate a mapping and show visual feedback
 * @param {Object} sourceProperty - Source property object
 * @param {Object} targetProperty - Target property object
 * @param {HTMLElement} feedbackElement - Element to show validation feedback
 * @returns {boolean} True if valid, false otherwise
 */
function validateMappingUI(sourceProperty, targetProperty, feedbackElement) {
  if (!sourceProperty || !targetProperty) {
    return true; // Not ready to validate yet
  }
  
  const compatible = areTypesCompatible(sourceProperty.type, targetProperty.type);
  
  if (feedbackElement) {
    if (compatible) {
      feedbackElement.innerHTML = `
        <div class="validation-success">
          ✅ Compatible: ${getTypeName(sourceProperty.type)} → ${getTypeName(targetProperty.type)}
        </div>
      `;
      feedbackElement.className = 'validation-feedback success';
    } else {
      feedbackElement.innerHTML = `
        <div class="validation-error">
          ❌ Incompatible: ${getTypeName(sourceProperty.type)} cannot map to ${getTypeName(targetProperty.type)}<br>
          <small>Compatible types: ${getCompatibleTypes(sourceProperty.type).map(getTypeName).join(', ')}</small>
        </div>
      `;
      feedbackElement.className = 'validation-feedback error';
    }
    feedbackElement.style.display = 'block';
  }
  
  return compatible;
}

/**
 * Validate dropdown options compatibility
 * @param {Object} sourceProperty - Source property with options
 * @param {Object} targetProperty - Target property with options
 * @returns {Object} { valid: boolean, warning?: string }
 */
function validateDropdownOptions(sourceProperty, targetProperty) {
  if (sourceProperty.type !== 'enumeration' || targetProperty.type !== 'enumeration') {
    return { valid: true };
  }
  
  if (!sourceProperty.options || !targetProperty.options) {
    return { valid: true };
  }
  
  const sourceValues = sourceProperty.options.map(o => o.value || o.label);
  const targetValues = targetProperty.options.map(o => o.value || o.label);
  
  const missingOptions = sourceValues.filter(v => !targetValues.includes(v));
  
  if (missingOptions.length > 0) {
    return {
      valid: false,
      warning: `⚠️ Target dropdown is missing ${missingOptions.length} option(s): ${missingOptions.join(', ')}`
    };
  }
  
  return { valid: true };
}

/**
 * Setup property selection with live validation
 * @param {HTMLSelectElement} sourceSelect - Source property dropdown
 * @param {HTMLSelectElement} targetSelect - Target property dropdown
 * @param {Array} sourceProperties - All source properties
 * @param {Array} targetProperties - All target properties
 * @param {HTMLElement} feedbackElement - Validation feedback element
 */
function setupPropertyValidation(sourceSelect, targetSelect, sourceProperties, targetProperties, feedbackElement) {
  // When source property changes, filter target properties
  sourceSelect.addEventListener('change', function() {
    const selectedProp = sourceProperties.find(p => p.name === this.value);
    
    if (!selectedProp) {
      targetSelect.innerHTML = '<option value="">Select target property</option>';
      return;
    }
    
    // Filter compatible target properties
    const compatibleTargets = filterCompatibleProperties(targetProperties, selectedProp.type);
    
    // Rebuild target dropdown
    targetSelect.innerHTML = '<option value="">Select target property</option>';
    compatibleTargets.forEach(prop => {
      const option = document.createElement('option');
      option.value = prop.name;
      option.textContent = `${prop.label} (${getTypeName(prop.type)})`;
      option.dataset.type = prop.type;
      targetSelect.appendChild(option);
    });
    
    // Clear validation feedback
    if (feedbackElement) {
      feedbackElement.style.display = 'none';
    }
  });
  
  // When target property changes, validate the mapping
  targetSelect.addEventListener('change', function() {
    const sourceProp = sourceProperties.find(p => p.name === sourceSelect.value);
    const targetProp = targetProperties.find(p => p.name === this.value);
    
    if (sourceProp && targetProp) {
      const isValid = validateMappingUI(sourceProp, targetProp, feedbackElement);
      
      // Check dropdown options if both are dropdowns
      if (isValid && sourceProp.type === 'enumeration' && targetProp.type === 'enumeration') {
        const dropdownCheck = validateDropdownOptions(sourceProp, targetProp);
        if (!dropdownCheck.valid && feedbackElement) {
          const existingContent = feedbackElement.innerHTML;
          feedbackElement.innerHTML = existingContent + '<br>' + dropdownCheck.warning;
        }
      }
    }
  });
}

// Export for use in settings page
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getCompatibleTypes,
    areTypesCompatible,
    getTypeName,
    filterCompatibleProperties,
    showTypeHint,
    validateMappingUI,
    validateDropdownOptions,
    setupPropertyValidation
  };
}
