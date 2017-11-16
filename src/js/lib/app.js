const Analytics = require('./analytics')
const Api = require('./api')

const Sip = require('./sip')
const Skeleton = require('./skeleton')
const Store = require('./store')
const Timer = require('./timer')


/**
* This is the main entry point for the Firefox web extension,
* the Chrome web extension and the Electron desktop app. It is used
* by the extension scripts for background(bg) and popup(ui).
*/
class App extends Skeleton {

    constructor(options) {
        super(options)

        // Some caching mechanism.
        window.cache = {}
        this.store = new Store(this)

        // Clears localstorage if the schema changed after a plugin update.
        if (!this.store.validSchema()) {
            this.modules.user.logout()
            return
        }

        // Keep track of some notifications.
        this.store.set('notifications', {})

        // Store settings to localstorage.
        for (let key in this.settings) {
            if (this.settings.hasOwnProperty(key)) {
                if (this.store.get(key) === null) {
                    this.store.set(key, this.settings[key])
                }
            }
        }


        // Continue last session if credentials are available.
        if (this.store.get('user') && this.store.get('username') && this.store.get('password')) {
            this.logger.info(`${this}reusing existing session from existing credentials`)
            this.reloadModules(false)

            if (this.env.extension && this.env.extension.background) {
                browser.browserAction.setIcon({path: 'img/icon-menubar-active.png'})
            }
        }
    }


    /**
    * Get platform URL from storage or set default.
    * @returns {String} - The cleaned up API endpoint url.
    */
    getPlatformUrl() {
        let platformUrl = this.store.get('platformUrl')

        if (!platformUrl) {
            // Set a default platform url from the brand when it's not set.
            platformUrl = process.env.PLATFORM_URL
            this.store.set('platformUrl', platformUrl)
        }

        // Force trailing slash.
        if (platformUrl && platformUrl.length && platformUrl.lastIndexOf('/') !== platformUrl.length - 1) {
            platformUrl = platformUrl + '/'
        }

        return platformUrl
    }


    /**
    * Get realm websocket URL from brand settings or set default.
    * @returns {String} - The websocket URL.
    */
    getWebsocketUrl() {
        let websocketUrl = this.store.get('realm')

        if (!websocketUrl) {
            // Set a default websocket url from the brand when it's not set.
            websocketUrl = process.env.SIP_ENDPOINT
            this.store.set('realm', websocketUrl)
        }

        return websocketUrl
    }


    /**
     * Check to see if the basic auth credentials are all available.
     * @returns {Boolean} - True if username and password are present.
     */
    hasCredentials() {
        if (this.store.get('user') && this.store.get('username') && this.store.get('password')) {
            return true
        }
        return false
    }


    /**
    * Reload all modules that have this method implemented.
    * @param {Boolean} update - Module indicator to update instead of (re)load.
    */
    reloadModules(update) {
        for (let module in this.modules) {
            // Use 'load' instead of 'restore' to refresh the data on
            // browser restart.
            if (this.modules[module]._load) {
                this.logger.debug(`${this}(re)loading module ${module}`)
                this.modules[module]._load(update)
            }
        }
        this.logger.debug(`${this}${this._listeners} listeners registered`)
    }


    /**
    * Restore all modules that have this method implemented.
    */
    restoreModules() {
        for (let module in this.modules) {
            if (this.modules[module]._restore) {
                this.logger.debug(`${this}restoring module ${module}`)
                this.modules[module]._restore()
            }
        }
    }


    /**
    * Reset all modules that have this method implemented.
    */
    resetModules() {
        for (let module in this.modules) {
            this.logger.debug(`${this}resetting module ${module}`)
            if (this.modules[module]._reset) {
                this.modules[module]._reset()
            }
        }
    }


    /**
    * Small helper that returns the version of the app.
    * The version is inserted at buildtime from the
    * package.json file.
    * @returns {String} - The current app's version.
    */
    version() {
        return process.env.VERSION
    }


    /**
    * Setup the SIP stack, before loading any modules.
    */
    _init() {
        this.settings = {
            analyticsId: process.env.ANALYTICS_ID,
            c2d: 'true',
            platformUrl: this.getPlatformUrl(),
            realm: this.getWebsocketUrl(),
        }
        this.timer = new Timer(this)
        if (this.env.extension) {
            // Only the background script in an extension has a sip stack.
            if (this.env.extension.background) {
                this.analytics = new Analytics(this, this.settings.analyticsId)
                this.api = new Api(this)
                this.sip = new Sip(this)
            }
        } else {
            this.analytics = new Analytics(this, this.settings.analyticsId)
            this.api = new Api(this)
            this.sip = new Sip(this)
        }
    }
}

module.exports = App
