const {_extend} = require('util')

const browserify = require('browserify')
const buffer = require('vinyl-buffer')
const childExec = require('child_process').exec
const cleanCSS = require('gulp-clean-css')
const composer = require('gulp-uglify/composer')
const concat = require('gulp-concat')
const connect = require('connect')
const envify = require('gulp-envify')
const fs = require('fs')
const gulp = require('gulp-help')(require('gulp'), {})
const gutil = require('gulp-util')
const http = require('http')
const ifElse = require('gulp-if-else')
const insert = require('gulp-insert')
const livereload = require('gulp-livereload')

const minifier = composer(require('uglify-es'), console)
const mount = require('connect-mount')
const notify = require('gulp-notify')
const path = require('path')
const runSequence = require('run-sequence')
const sass = require('gulp-sass')
const serveIndex = require('serve-index')
const serveStatic = require('serve-static')
const size = require('gulp-size')
const source = require('vinyl-source-stream')
const sourcemaps = require('gulp-sourcemaps')
const watchify = require('watchify')

// Browserify instance caching.
let BUNDLERS = {bg: null, callstatus: null, popup: null, tab: null}
// Switches extra application verbosity on/off.


/**
* This helper class is here, so the main gulpfile won't get
* beyond 500 lines. Generally implement custom logic here,
* and call it from the main gulpfile.
*/
class Helpers {

    constructor(settings) {
        this.settings = settings
    }


    /**
    * Build the plugin and deploy it to an environment.
    * Currently, branded builds can be deployed to chrome and firefox.
    * @param {String} brandName - Brand to deploy.
    * @param {String} buildType - Environment to deploy to.
    * @param {String} distributionName - Name of the generated build zip.
    * @returns {Promise} - Resolves when done deploying.
    */
    deploy(brandName, buildType, distributionName) {
        return new Promise((resolve, reject) => {
            const PACKAGE = require('../package')

            if (buildType === 'chrome') {
                runSequence('build-dist', async() => {
                    const api = this.settings.brands[brandName].store.chrome
                    const zipFile = fs.createReadStream(`./dist/${brandName}/${buildType}/${distributionName}`)

                    let extensionId
                    // Deploy to production or test environment, based on DEPLOY_TARGET.
                    if (this.settings.DEPLOY_TARGET === 'production') extensionId = api.extensionId
                    else if (this.settings.DEPLOY_TARGET === 'beta') extensionId = api.extensionId_beta

                    const webStore = require('chrome-webstore-upload')({
                        clientId: api.clientId,
                        clientSecret: api.clientSecret,
                        extensionId: extensionId,
                        refreshToken: api.refreshToken,
                    })

                    const token = await webStore.fetchToken()
                    const res = await webStore.uploadExisting(zipFile, token)

                    if (res.uploadState !== 'SUCCESS') {
                        gutil.log(`An error occured during uploading: ${JSON.stringify(res, null, 4)}`)
                        return
                    }

                    gutil.log(`Uploaded extension version ${PACKAGE.version} to chrome store.`)
                    // Chrome store has a distinction to publish for `trustedTesters` and
                    // `default`(world). Instead, we use a separate extension which
                    // gives us more control over the release process.
                    try {
                        const _res = await webStore.publish('default', token)
                        if (_res.status.includes('OK')) {
                            // eslint-disable-next-line max-len
                            gutil.log(`Succesfully published extension version ${PACKAGE.version}.`)
                            resolve()
                        } else {
                            gutil.log(`An error occured during publishing: ${JSON.stringify(_res, null, 4)}`)
                        }
                    } catch (err) {
                        gutil.log(err)
                    }
                })
            } else if (buildType === 'firefox') {
                // The extension target is defined in the manifest.
                runSequence('build', () => {
                    // A Firefox extension version number can only be signed and
                    // uploaded once using web-ext. The second time will fail with an
                    // unobvious reason.
                    const api = this.settings.brands[brandName].store.firefox
                    // eslint-disable-next-line max-len
                    let _cmd = `web-ext sign --source-dir ./build/${brandName}/${buildType} --api-key ${api.apiKey} --api-secret ${api.apiSecret} --artifacts-dir ./build/${brandName}/${buildType}`
                    let child = childExec(_cmd, undefined, (err, stdout, stderr) => {
                        if (stderr) gutil.log(stderr)
                        if (stdout) gutil.log(stdout)
                        resolve()
                    })

                    child.stdout.on('data', (data) => {
                        process.stdout.write(`${data.toString()}\r`)
                    })
                })
            }
        })
    }


    /**
    * Generate a brand-specific distribution name.
    * @param {String} brandName - The brand name to use for the distribution.
    * @returns {String} - The distribution name to use.
    */
    distributionName(brandName) {
        let distributionName = `${brandName}-${this.settings.PACKAGE.version}`
        if (this.settings.DEPLOY_TARGET === 'beta') {
            distributionName += '-beta'
        }
        distributionName += '.zip'
        return distributionName
    }


    /**
    * Converts branding data to a valid SCSS variables string.
    * @param {Object} brandProperties: Key/value object that's converted to a SCSS variable string.
    * @returns {String} - Scss-formatted variables string.
    */
    formatScssVars(brandProperties) {
        return Object.keys(brandProperties).map((name) => '$' + name + ': ' + brandProperties[name] + ';').join('\n')
    }


    /**
    * Read the manifest file and augment it with generic
    * variable options(e.g. branding options)
    * that are not browser-specific.
    * @param {String} brandName - Brand to generate a manifest for.
    * @param {String} buildType - Target environment to generate a manifest for.
    * @returns {Object} - The manifest template.
    */
    getManifest(brandName, buildType) {
        const PACKAGE = require('../package')
        let manifest = require('../src/manifest.json')
        // The 16x16px icon is used for the context menu.
        // It is different from the logo.
        manifest.name = this.settings.brands[brandName].name
        // Distinguish between the test-version and production
        // by adding a `beta` postfix.
        if (this.settings.DEPLOY_TARGET === 'beta') manifest.name = `${manifest.name}-beta`

        if (buildType === 'chrome') {
            manifest.options_ui.chrome_style = false
        } else if (buildType === 'firefox') {
            // The id_beta property should not end up in the manifest.
            let betaId = this.settings.brands[brandName].store.firefox.gecko.id_beta
            delete this.settings.brands[brandName].store.firefox.gecko.id_beta

            manifest.options_ui.browser_style = true
            manifest.applications = {
                gecko: this.settings.brands[brandName].store.firefox.gecko,
            }
            // The deploy target for Firefox is specified in the manifest,
            // instead of being passed with the API call to the store.
            if (this.settings.DEPLOY_TARGET === 'beta') manifest.applications.gecko.id = betaId
        }

        manifest.browser_action.default_title = this.settings.brands[brandName].name
        manifest.permissions.push(this.settings.brands[brandName].permissions)
        manifest.homepage_url = this.settings.brands[brandName].homepage_url
        manifest.version = PACKAGE.version
        return manifest
    }


    /**
    * Return a browserify function task used for multiple entrypoints.
    * @param {String} brandName - Brand to produce js for.
    * @param {String} buildType - Target environment to produce js for.
    * @param {String} jsName - Name of the js entrypoint.
    * @returns {Function} - Browerserify bundle function to use.
    */
    jsEntry(brandName, buildType, jsName) {
        return (done) => {
            if (!BUNDLERS[jsName]) {
                BUNDLERS[jsName] = browserify({
                    cache: {},
                    debug: !this.settings.PRODUCTION,
                    entries: path.join(this.settings.SRC_DIR, 'js', `${jsName}.js`),
                    packageCache: {},
                })
                if (this.settings.LIVERELOAD) BUNDLERS[jsName].plugin(watchify)
            }
            BUNDLERS[jsName].ignore('process')
            BUNDLERS[jsName].bundle()
                .on('error', notify.onError('Error: <%= error.message %>'))
                .on('end', () => {
                    done()
                })
                .pipe(source(`${jsName}.js`))
                .pipe(buffer())
                .pipe(ifElse(!this.settings.PRODUCTION, () => sourcemaps.init({loadMaps: true})))
                .pipe(envify({
                    ANALYTICS_ID: this.settings.brands[brandName].analytics_id,
                    HOMEPAGE: this.settings.brands[brandName].homepage_url,
                    NODE_ENV: this.settings.NODE_ENV,
                    PLATFORM_URL: this.settings.brands[brandName].permissions,
                    SIP_ENDPOINT: this.settings.brands[brandName].sip_endpoint,
                    VERBOSE: this.settings.VERBOSE,
                    VERSION: this.settings.PACKAGE.version,
                }))
                .pipe(ifElse(this.settings.PRODUCTION, () => minifier()))
                .pipe(ifElse(!this.settings.PRODUCTION, () => sourcemaps.write('./')))
                .pipe(gulp.dest(path.join(this.settings.BUILD_DIR, brandName, buildType, 'js')))
                .pipe(size(_extend({title: `${jsName}.js`}, this.settings.SIZE_OPTIONS)))
        }
    }


    /**
    * Generic scss task used for multiple entrypoints.
    * @param {String} brandName - Brand to produce scss for.
    * @param {String} buildType - Target environment to produce scss for.
    * @param {String} scssName - Name of the scss entrypoint.
    * @returns {Function} - Sass function to use.
    */
    scssEntry(brandName, buildType, scssName) {
        const brandColors = this.formatScssVars(this.settings.brands[brandName].colors)
        return () => {
            return gulp.src(`./src/scss/${scssName}.scss`)
                .pipe(insert.prepend(brandColors))
                .pipe(sass({
                    includePaths: this.settings.NODE_PATH,
                    sourceMap: !this.settings.PRODUCTION,
                    sourceMapContents: !this.settings.PRODUCTION,
                    sourceMapEmbed: !this.settings.PRODUCTION,
                }))
                .on('error', notify.onError('Error: <%= error.message %>'))
                .pipe(concat(`${scssName}.css`))
                .pipe(ifElse(this.settings.PRODUCTION, () => cleanCSS({advanced: true, level: 2})))
                .pipe(gulp.dest(path.join(this.settings.BUILD_DIR, brandName, buildType, 'css')))
                .pipe(size(_extend({title: `scss-${scssName}`}, this.settings.SIZE_OPTIONS)))
        }
    }


    /**
    * Fire up a development server that serves docs
    * and the build directory.
    */
    startDevServer() {
        gutil.log('Starting development server. Hit Ctrl-c to quit.')
        const app = connect()
        livereload.listen({silent: false})
        app.use(serveStatic(path.join(__dirname, 'build')))
        app.use('/', serveIndex(path.join(__dirname, 'build'), {icons: false}))
        app.use(mount('/docs', serveStatic(path.join(__dirname, 'docs', 'build'))))
        http.createServer(app).listen(8999)
    }
}


module.exports = Helpers
