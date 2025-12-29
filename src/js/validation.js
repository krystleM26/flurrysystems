// Form validation functions
export function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

export function validateForm(formData) {
    const email = formData.get('from_email');
    const name = formData.get('from_name');
    const company = formData.get('company_name');
    
    if (!name || name.trim().length < 2) {
        return { valid: false, message: 'Please enter your name' };
    }
    
    if (!validateEmail(email)) {
        return { valid: false, message: 'Please enter a valid email' };
    }
    
    if (!company || company.trim().length < 2) {
        return { valid: false, message: 'Please enter your company name' };
    }
    
    return { valid: true };
}