// EmailJS Configuration and Form Handling for Flurry Systems

// ========================================
// CONFIGURATION - Replace with your actual EmailJS credentials
// ========================================
const EMAILJS_CONFIG = {
    publicKey: 'YOUR_PUBLIC_KEY_HERE',    // Replace with your public key
    serviceId: 'service_2s9dx78',         // Your service ID
    templateId: 'ccyps7m'                 // Your template ID
};

// ========================================
// Initialize EmailJS
// ========================================
(function() {
    emailjs.init(EMAILJS_CONFIG.publicKey);
})();

// ========================================
// Form Submission Handler
// ========================================
document.addEventListener('DOMContentLoaded', function() {
    const contactForm = document.getElementById('contact-form');
    
    if (contactForm) {
        contactForm.addEventListener('submit', handleFormSubmit);
    }
});

function handleFormSubmit(event) {
    event.preventDefault();
    
    const submitBtn = document.getElementById('submit-btn');
    const statusMsg = document.getElementById('status-message');
    
    // Disable button and show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    statusMsg.textContent = '';
    
    // Send email using EmailJS
    emailjs.sendForm(
        EMAILJS_CONFIG.serviceId,
        EMAILJS_CONFIG.templateId,
        event.target
    )
    .then(function(response) {
        // Success
        console.log('Email sent successfully!', response.status, response.text);
        showSuccess(submitBtn, statusMsg);
        event.target.reset(); // Clear the form
    })
    .catch(function(error) {
        // Error
        console.error('Email send failed:', error);
        showError(submitBtn, statusMsg, error);
    });
}

// ========================================
// UI Feedback Functions
// ========================================
function showSuccess(submitBtn, statusMsg) {
    statusMsg.className = 'text-sm mt-2 text-green-600 font-semibold';
    statusMsg.textContent = '✓ Thanks! We\'ll reach out within 24 hours.';
    
    submitBtn.textContent = 'Sent Successfully!';
    submitBtn.className = 'w-full bg-green-600 text-white py-4 rounded-lg font-bold text-lg';
    
    // Reset button after 3 seconds
    setTimeout(function() {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Book Free Audit';
        submitBtn.className = 'w-full bg-indigo-600 text-white py-4 rounded-lg font-bold text-lg hover:bg-indigo-700 transition';
        statusMsg.textContent = '';
    }, 3000);
}

function showError(submitBtn, statusMsg, error) {
    statusMsg.className = 'text-sm mt-2 text-red-600 font-semibold';
    statusMsg.textContent = '✗ Something went wrong. Please try again or email us directly.';
    
    submitBtn.disabled = false;
    submitBtn.textContent = 'Book Free Audit';
    
    // Log error details for debugging
    console.error('Error details:', {
        message: error.text || error.message,
        status: error.status
    });
}

// ========================================
// Optional: Form Validation
// ========================================
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validateForm(formData) {
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