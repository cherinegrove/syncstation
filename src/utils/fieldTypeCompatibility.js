// src/utils/fieldTypeCompatibility.js
// Field type validation and compatibility checking for PropBridge

/**
 * Field Type Compatibility Matrix
 * Defines which HubSpot property types can be mapped to each other
 */
const COMPATIBILITY_MAP = {
  // Text types - can map to other text variants
  'string': ['string', 'enumeration', 'textarea', 'phonenumber', 'email'],
  
  // Textarea can map to string or textarea
  'textarea': ['string', 'textarea'],
  
  // Numbers - strict, only to numbers
  'number': ['number'],
  
  // Dates - can map between date and datetime
  'date': ['date', 'datetime'],
  'datetime': ['date', 'datetime'],
  
  // Enumerations (dropdowns) - can map to dropdown or text
  'enumeration': ['enumeration', 'string', 'textarea'],
  
  // Boolean/checkbox - strict
  'bool': ['bool'],
  
  // Special types - can map to text
  'phonenumber': ['phonenumber', 'string'],
  'email': ['email', 'string'],
  
  // Multi-select - can map to multi-select or text
  'multiselect': ['multiselect', 'textarea'],
  
  // File - strict, file to file only
  'file': ['file'],
};

/**
 * Check if two field types are compatible for syncing
 * @param {string} sourceType - The source property type
 * @param {string} targetType - The target property type
 * @returns {boolean} True if compatible, false otherwise
 */
function areTypesCompatible(sourceType, targetType) {
  // Exact match is always compatible
  if (sourceType === targetType) return true;
  
  // Check compatibility matrix
  const compatibleTypes = COMPATIBILITY_MAP[sourceType];
  if (!compatibleTypes) {
    // Unknown type - allow but warn
    console.warn(`[FieldTypes] Unknown source type: ${sourceType}`);
    return sourceType === targetType;
  }
  
  return compatibleTypes.includes(targetType);
}

/**
 * Get list of compatible target types for a given source type
 * @param {string} sourceType - The source property type
 * @returns {string[]} Array of compatible target types
 */
function getCompatibleTypes(sourceType) {
  return COMPATIBILITY_MAP[sourceType] || [sourceType];
}

/**
 * Validate dropdown/enumeration option compatibility
 * Checks if all source dropdown options exist in target dropdown
 * @param {object} sourceProp - Source property object with options array
 * @param {object} targetProp - Target property object with options array
 * @returns {object} { valid: boolean, warning?: string, missingOptions?: string[] }
 */
function validateDropdownOptions(sourceProp, targetProp) {
  // Only validate if both are enumerations
  if (sourceProp.type !== 'enumeration' || targetProp.type !== 'enumeration') {
    return { valid: true };
  }
  
  // If either has no options, can't validate (might be dynamic)
  if (!sourceProp.options || !targetProp.options) {
    return { 
      valid: true,
      warning: 'Unable to validate dropdown options - one or both dropdowns may be dynamic'
    };
  }
  
  const sourceOptions = sourceProp.options.map(o => o.value || o.label);
  const targetOptions = targetProp.options.map(o => o.value || o.label);
  
  // Check if all source options exist in target
  const missingOptions = sourceOptions.filter(opt => !targetOptions.includes(opt));
  
  if (missingOptions.length > 0) {
    return {
      valid: false,
      warning: `Target dropdown is missing ${missingOptions.length} option(s): ${missingOptions.join(', ')}. ` +
               `Records with these values may fail to sync or sync with empty values.`,
      missingOptions
    };
  }
  
  return { valid: true };
}

/**
 * Validate a complete mapping configuration
 * @param {object} sourceProperty - Source property metadata
 * @param {object} targetProperty - Target property metadata
 * @returns {object} { valid: boolean, error?: string, warning?: string }
 */
function validateMapping(sourceProperty, targetProperty) {
  // Check type compatibility
  if (!areTypesCompatible(sourceProperty.type, targetProperty.type)) {
    return {
      valid: false,
      error: `Incompatible types: "${sourceProperty.label}" (${sourceProperty.type}) ` +
             `cannot map to "${targetProperty.label}" (${targetProperty.type}). ` +
             `Compatible types for ${sourceProperty.type}: ${getCompatibleTypes(sourceProperty.type).join(', ')}`
    };
  }
  
  // Check dropdown options if both are dropdowns. A mismatch here means some
  // values may not carry over cleanly — worth flagging, but the mapping itself
  // is valid (the types are compatible and most values will sync fine), so
  // this is always a warning, never a save-blocking error.
  if (sourceProperty.type === 'enumeration' && targetProperty.type === 'enumeration') {
    const dropdownValidation = validateDropdownOptions(sourceProperty, targetProperty);
    if (dropdownValidation.warning) {
      return {
        valid: true,
        warning: dropdownValidation.warning,
        missingOptions: dropdownValidation.missingOptions
      };
    }
  }
  
  return { valid: true };
}

/**
 * Get user-friendly type name for display
 * @param {string} type - HubSpot property type
 * @returns {string} Display-friendly type name
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

module.exports = {
  areTypesCompatible,
  getCompatibleTypes,
  validateDropdownOptions,
  validateMapping,
  getTypeName,
  COMPATIBILITY_MAP
};
