/**
* @module User
*/
class UserModule {

    constructor(app) {
        this.app = app
    }


    addListeners() {
        let _$ = {}
        _$.accountInfo = $('#user-name')
        _$.emailInput = $('#username')
        _$.loginButton = $('.login-button')
        _$.passwordInput = $('#password')

        const login = () => {
            // Login when form is not empty.
            if (_$.emailInput.val().trim().length && _$.passwordInput.val().length) {
                this.app.emit('user:login.attempt', {
                    password: _$.passwordInput.val(),
                    username: _$.emailInput.val().trim(),
                })
            }
        }


        // This prevents an extra tabbable focus element
        // (the popup container) in Firefox.
        $('.login-form :input').keydown((e) => {
            if (e.which === 9) {
                let inputs = $('.login-form :input').filter((index, input) => {
                    return e.currentTarget.tabIndex < input.tabIndex
                })

                if (inputs.length === 0) _$.emailInput.focus()
                else $(inputs[0]).focus()
                e.preventDefault()
            }
        })

        // Handle toggling the login button and logging in on enter.
        $('.login-form :input').keyup((e) => {
            // Toggle disabling/enabling of the login button based on the
            // validity of the input elements.
            if (_$.emailInput.val().trim().length && _$.passwordInput.val().length) {
                _$.loginButton.prop('disabled', false)
            } else {
                _$.loginButton.prop('disabled', true)
            }
            // Login on enter.
            if (e.which === 13) {
                e.preventDefault()
                login()
            }
        })


        // Login with the button.
        _$.loginButton.on('click', (e) => {
            login()
        })

        // Change the stored username/emailaddress on typing, so
        // we can restore the value when the popup is restarted.
        _$.emailInput.keyup((e) => {
            this.app.store.set('username', e.currentTarget.value)
        })
        // Set the username/emailaddress field on load, when we still
        // have a cached value from localstorage.
        if (this.app.store.get('username')) {
            _$.emailInput.val(this.app.store.get('username'))
        }

        /**
        * Show an error on login fail.
        */
        this.app.on('user:login.failed', (data) => {
            let button = $('.login-button')
            // This is an indication that an incorrect platform url is used.
            if (data.reason === 404) this.app.modules.ui.setButtonState(button, 'error', true, 0)
            else this.app.modules.ui.setButtonState(button, 'failed', true, 0)
            this.app.modules.ui.setButtonState(button, 'default', function() {
                if (_$.emailInput.val().trim().length && _$.passwordInput.val().length) {
                    return false
                } else {
                    return true
                }
            })
        })

        /**
        * Display an indicator when logging in.
        */
        this.app.on('user:login.in_progress', (data) => {
            this.app.modules.ui.setButtonState($('.login-button'), 'loading', true, 0)
        })

        // After login, show the user's e-mail address.
        this.app.on('user:login.success', (data) => {
            _$.accountInfo.text(data.user.email)
            $('.login-section').addClass('hide')
            this.app.modules.ui.showPopup()
        })

        this.app.on('user:logout.success', (data) => {
            // Hide the main panel.
            $('.container').addClass('hide')

            // Show the login form.
            $('.login-section').removeClass('hide')
            // Reset the login form input.
            $('.login-form :input:visible').val('')
            // Set the username/emailaddress field on load, when we still
            // have a cached value from localstorage.
            if (this.app.store.get('username')) {
                _$.emailInput.val(this.app.store.get('username'))
            }

            // Focus the first input field.
            $('.login-form :input:visible:first').focus()

            // Show a message on logout.
            let button = $('.login-button')
            this.app.modules.ui.setButtonState(button, 'logout', true, 0)
            this.app.modules.ui.setButtonState(button, 'default', true)
        })
    }
}

module.exports = UserModule
