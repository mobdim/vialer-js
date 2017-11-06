const {_extend, promisify} = require('util')
const fs = require('fs')
const path = require('path')

const addsrc = require('gulp-add-src')
const argv = require('yargs').argv
const browserify = require('browserify')
const buffer = require('vinyl-buffer')
const childExec = require('child_process').exec
const cleanCSS = require('gulp-clean-css')
const composer = require('gulp-uglify/composer')
const concat = require('gulp-concat')
const connect = require('connect')
const del = require('del')

const envify = require('gulp-envify')
const flatten = require('gulp-flatten')
const ghPages = require('gulp-gh-pages')
const gulp = require('gulp-help')(require('gulp'), {})
const gutil = require('gulp-util')
const http = require('http')
const livereload = require('gulp-livereload')
const ifElse = require('gulp-if-else')
const insert = require('gulp-insert')
const imagemin = require('gulp-imagemin')
const mkdirp = require('mkdirp')
const minifier = composer(require('uglify-es'), console)
const mount = require('connect-mount')

const notify = require('gulp-notify')
const rename = require('gulp-rename')
const replace = require('gulp-replace')
const rc = require('rc')
const runSequence = require('run-sequence')
const sass = require('gulp-sass')
const serveIndex = require('serve-index')
const serveStatic = require('serve-static')
const size = require('gulp-size')
const source = require('vinyl-source-stream')
const sourcemaps = require('gulp-sourcemaps')
const watchify = require('watchify')
const zip = require('gulp-zip')

const PACKAGE = require('./package')
const writeFileAsync = promisify(fs.writeFile)

const BUILD_DIR = process.env.BUILD_DIR || path.join(__dirname, 'build')
const BUILD_TARGET = argv.target ? argv.target : 'chrome'
const BUILD_TARGETS = ['chrome', 'firefox', 'electron']
const DISTRIBUTION_NAME = `${PACKAGE.name.toLowerCase()}-${PACKAGE.version}.zip`
const GULPACTION = argv._[0]

const NODE_PATH = path.join(__dirname, 'node_modules') || process.env.NODE_PATH
const SRC_DIR = path.join(__dirname, 'src')
const WATCHLINKED = argv.linked ? argv.linked : false
const WITHDOCS = argv.docs ? argv.docs : false

let PRODUCTION
let NODE_ENV

// Switches extra applicationverbosity on/off.
let VERBOSE = false
if ((process.env.VERBOSE === 'true') || (process.env.VERBOSE === '1')) VERBOSE = true

// Loads the json API settings from ~/.vialer-jsrc.
let VIALER_SETTINGS = {}
rc('vialer-js', VIALER_SETTINGS)
VIALER_SETTINGS.audience = argv.audience ? argv.audience : 'trustedTesters'

// Specify the brand target or fallback to `vialer` as default.
const BRAND_TARGET = argv.brand ? argv.brand : 'vialer'

// Some additional variable processing.
// Verify that the build target is valid.
if (!BUILD_TARGETS.includes(BUILD_TARGET)) {
    gutil.log(`Invalid build target: ${BUILD_TARGET}`)
    // eslint-disable-next-line no-process-exit
    process.exit()
}
gutil.log(`Build target: ${BUILD_TARGET}`)
gutil.log(`Brand target: ${BRAND_TARGET}`)

// Force production mode when running certain tasks from
// the commandline. Use this with care.
if (['deploy', 'build-dist'].includes(GULPACTION)) {
    PRODUCTION = true
    process.env.NODE_ENV = 'production'
} else {
    PRODUCTION = argv.production ? argv.production : (process.env.NODE_ENV === 'production')
}

NODE_ENV = process.env.NODE_ENV || 'development'

// Notify developer about some essential build presets.
if (PRODUCTION) gutil.log(`Production mode: ${PRODUCTION}`)

let bundlers = {
    bg: null,
    callstatus: null,
    popup: null,
    tab: null,
}
let isWatching
let sizeOptions = {
    showFiles: true,
    showTotal: true,
}


/**
* Converts branding data to a valid SCSS variables string.
* @param {Object} brandProperties: Key/value object that's converted to a SCSS variable string.
* @returns {String} - Scss-formatted variables string.
*/
function formatScssVars(brandProperties) {
    return Object.keys(brandProperties).map((name) => '$' + name + ': ' + brandProperties[name] + ';').join('\n')
}


/**
* Read the manifest file and augment it with generic
* variable options(e.g. branding options)
* that are not browser-specific.
* @returns {Object} - The manifest template.
*/
const getManifest = () => {
    let manifest = require('./src/manifest.json')
    // The 16x16px icon is used for the context menu.
    // It is different from the logo.
    manifest.name = VIALER_SETTINGS.brands[BRAND_TARGET].name
    manifest.browser_action.default_title = VIALER_SETTINGS.brands[BRAND_TARGET].name
    manifest.permissions.push(VIALER_SETTINGS.brands[BRAND_TARGET].permissions)
    manifest.homepage_url = VIALER_SETTINGS.brands[BRAND_TARGET].homepage_url
    manifest.version = PACKAGE.version
    return manifest
}


/**
* Return a browserify function task used for multiple entrypoints.
* @param {String} name - Name of the javascript entrypoint.
* @returns {Function} - Browerserify bundle function to use.
*/
const jsEntry = (name) => {
    return (done) => {
        if (!bundlers[name]) {
            bundlers[name] = browserify({
                cache: {},
                debug: !PRODUCTION,
                entries: path.join(__dirname, 'src', 'js', `${name}.js`),
                packageCache: {},
            })
            if (isWatching) bundlers[name].plugin(watchify)
        }
        bundlers[name].ignore('process')
        bundlers[name].bundle()
            .on('error', notify.onError('Error: <%= error.message %>'))
            .on('end', () => {
                done()
            })
            .pipe(source(`${name}.js`))
            .pipe(buffer())
            .pipe(ifElse(!PRODUCTION, () => sourcemaps.init({loadMaps: true})))
            .pipe(envify({
                ANALYTICS_ID: VIALER_SETTINGS.brands[BRAND_TARGET].analytics_id,
                HOMEPAGE: VIALER_SETTINGS.brands[BRAND_TARGET].homepage_url,
                NODE_ENV: NODE_ENV,
                PLATFORM_URL: VIALER_SETTINGS.brands[BRAND_TARGET].permissions,
                SIP_ENDPOINT: VIALER_SETTINGS.brands[BRAND_TARGET].sip_endpoint,
                VERBOSE: VERBOSE,
                VERSION: PACKAGE.version,
            }))
            .pipe(ifElse(PRODUCTION, () => minifier()))

            .pipe(ifElse(!PRODUCTION, () => sourcemaps.write('./')))
            .pipe(gulp.dest(`./build/${BRAND_TARGET}/${BUILD_TARGET}/js`))
            .pipe(size(_extend({title: `${name}.js`}, sizeOptions)))
    }
}


/**
* Generic scss task used for multiple entrypoints.
* @param {String} name - Name of the scss entrypoint.
* @returns {Function} - Sass function to use.
*/
const scssEntry = (name) => {
    const brandColors = formatScssVars(VIALER_SETTINGS.brands[BRAND_TARGET].colors)
    return () => {
        return gulp.src(`./src/scss/${name}.scss`)
            .pipe(insert.prepend(brandColors))
            .pipe(sass({
                includePaths: NODE_PATH,
                sourceMap: !PRODUCTION,
                sourceMapContents: !PRODUCTION,
                sourceMapEmbed: !PRODUCTION,
            }))
            .on('error', notify.onError('Error: <%= error.message %>'))
            .pipe(concat(`${name}.css`))
            .pipe(ifElse(PRODUCTION, () => cleanCSS({advanced: true, level: 2})))
            .pipe(gulp.dest(`./build/${BRAND_TARGET}/${BUILD_TARGET}/css`))
            .pipe(size(_extend({title: `scss-${name}`}, sizeOptions)))
    }
}


gulp.task('assets', 'Copy assets to the build directory.', ['fonts'], () => {
    return gulp.src(`./src/brand/${BRAND_TARGET}/img/{*.png,*.jpg}`, {base: `./src/brand/${BRAND_TARGET}/`})
        .pipe(ifElse(PRODUCTION, imagemin))
        .pipe(addsrc('./LICENSE'))
        .pipe(addsrc('./README.md'))
        .pipe(addsrc('./src/_locales/**', {base: './src/'}))
        .pipe(addsrc('./src/js/lib/thirdparty/**/*.js', {base: './src/'}))
        .pipe(gulp.dest(`./build/${BRAND_TARGET}/${BUILD_TARGET}`))
        .pipe(size(_extend({title: 'assets'}, sizeOptions)))
        .pipe(ifElse(isWatching, livereload))
})


gulp.task('build', 'Clean existing build and regenerate a new one.', (done) => {
    // Refresh the brand content with each build.
    let targetTasks
    if (BUILD_TARGET === 'electron') targetTasks = ['js-electron-main', 'js-electron-webview', 'js-vendor']
    else targetTasks = ['js-vendor', 'js-webext']

    runSequence(['assets', 'html', 'scss'].concat(targetTasks), done)
})


gulp.task('build-dist', 'Make a build and generate a web-extension zip file.', (done) => {
    runSequence('build', async function() {
        // Use the web-ext build method here, so the result will match
        // the deployable version as closely as possible.
        if (BUILD_TARGET === 'firefox') {
            // eslint-disable-next-line max-len
            let execCommand = `web-ext build --overwrite-dest --source-dir ./build/${BRAND_TARGET}/${BUILD_TARGET} --artifacts-dir ./dist/${BUILD_TARGET}/`
            let child = childExec(execCommand, undefined, (err, stdout, stderr) => {
                if (stderr) gutil.log(stderr)
                if (stdout) gutil.log(stdout)
                done()
            })

            child.stdout.on('data', (data) => {
                process.stdout.write(`${data.toString()}\r`)
            })
        } else {
            gulp.src([`./build/${BRAND_TARGET}/${BUILD_TARGET}/**`], {base: `./build/${BRAND_TARGET}/${BUILD_TARGET}`})
                .pipe(zip(DISTRIBUTION_NAME))
                .pipe(gulp.dest(`./dist/${BRAND_TARGET}/${BUILD_TARGET}/`))
                .on('end', done)
        }
    })
})


gulp.task('build-clean', `Clean build directory ${path.join(BUILD_DIR, BRAND_TARGET, BUILD_TARGET)}`, async() => {
    await del([path.join(BUILD_DIR, BRAND_TARGET, BUILD_TARGET, '**')], {force: true})
    mkdirp(path.join(BUILD_DIR, BRAND_TARGET, BUILD_TARGET))
})


gulp.task('deploy', (done) => {
    if (BUILD_TARGET === 'chrome') {
        runSequence('build-dist', async function() {
            const api = VIALER_SETTINGS[BRAND_TARGET].store.chrome
            const zipFile = fs.createReadStream(`./dist/${BRAND_TARGET}/${BUILD_TARGET}/${DISTRIBUTION_NAME}`)

            let targetExtension

            // Deploy to production environment.
            if (VIALER_SETTINGS.audience === 'default') {
                targetExtension = api.extensionId
            } else {
                // Deploy to test extension.
                targetExtension = api.extensionId_test
            }

            const webStore = require('chrome-webstore-upload')({
                clientId: api.clientId,
                clientSecret: api.clientSecret,
                extensionId: targetExtension,
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
                    gutil.log(`Succesfully published extension version ${PACKAGE.version} for ${VIALER_SETTINGS.audience}.`)
                    done()
                } else {
                    gutil.log(`An error occured during publishing: ${JSON.stringify(_res, null, 4)}`)
                }
            } catch (err) {
                gutil.log(err)
            }
        })
    } else if (BUILD_TARGET === 'firefox') {
        runSequence('build', function() {
            // A Firefox extension version number can only be signed and
            // uploaded once using web-ext. The second time will fail with an
            // unobvious reason.
            const api = VIALER_SETTINGS[BRAND_TARGET].store.firefox
            // eslint-disable-next-line max-len
            let _cmd = `web-ext sign --source-dir ./build/${BRAND_TARGET}/${BUILD_TARGET} --api-key ${api.apiKey} --api-secret ${api.apiSecret} --artifacts-dir ./build/${BRAND_TARGET}/${BUILD_TARGET}`
            let child = childExec(_cmd, undefined, (err, stdout, stderr) => {
                if (stderr) gutil.log(stderr)
                if (stdout) gutil.log(stdout)
                done()
            })

            child.stdout.on('data', (data) => {
                process.stdout.write(`${data.toString()}\r`)
            })
        })
    }
})


gulp.task('docs', 'Generate documentation.', (done) => {
    let execCommand = `node ${NODE_PATH}/jsdoc/jsdoc.js ./src/js -R ./README.md -c ./.jsdoc.json -d ${BUILD_DIR}/docs --package ./package.json`
    childExec(execCommand, undefined, (err, stdout, stderr) => {
        if (stderr) gutil.log(stderr)
        if (stdout) gutil.log(stdout)
        if (isWatching) livereload.changed('rtd.js')
        done()
    })
})


gulp.task('docs-deploy', 'Push the docs build directory to github pages.', ['docs'], () => {
    return gulp.src(`${BRAND_TARGET}/${BUILD_DIR}/docs/**/*`).pipe(ghPages())
})


gulp.task('fonts', 'Copy fonts to the build directory.', () => {
    const robotoBasePath = path.join(NODE_PATH, 'roboto-fontface', 'fonts', 'roboto')

    return gulp.src(path.join(SRC_DIR, 'fonts', '*'))
        .pipe(addsrc(path.join(robotoBasePath, 'Roboto-Light.woff2')))
        .pipe(addsrc(path.join(robotoBasePath, 'Roboto-Regular.woff2')))
        .pipe(addsrc(path.join(robotoBasePath, 'Roboto-Medium.woff2')))
        .pipe(flatten())
        .pipe(gulp.dest(`./build/${BRAND_TARGET}/${BUILD_TARGET}/fonts`))
        .pipe(size(_extend({title: 'fonts'}, sizeOptions)))
})


gulp.task('html', 'Add html to the build directory.', () => {
    let jsbottom, jshead, target

    if (BUILD_TARGET === 'electron') {
        target = 'electron'
        jshead = '<script src="js/lib/thirdparty/SIPml-api.js"></script>'
        jsbottom = '<script src="js/electron_webview.js"></script>'

    } else {
        target = 'webext'
        jshead = ''
        jsbottom = '<script src="js/webext_popup.js"></script>'
    }

    // The webext_popup.html file is shared with the electron build target.
    // Appropriate scripts are inserted based on the build target.
    return gulp.src(path.join('src', 'html', 'webext_popup.html'))
        .pipe(replace('<!--JSBOTTOM-->', jsbottom))
        .pipe(replace('<!--JSHEAD-->', jshead))
        .pipe(flatten())
        .pipe(ifElse((target === 'electron'), () => rename('electron_webview.html')))
        .pipe(ifElse((target === 'webext'), () => addsrc(path.join('src', 'html', 'webext_{options,callstatus}.html'))))
        .pipe(gulp.dest(`./build/${BRAND_TARGET}/${BUILD_TARGET}`))
        .pipe(ifElse(isWatching, livereload))
})


gulp.task('js-electron', 'Generate electron js.', (done) => {
    runSequence([
        'js-electron-main',
        'js-electron-webview',
        'js-vendor',
    ], done)
})


gulp.task('js-electron-main', 'Generate electron main thread js.', ['js-electron-webview'], () => {
    return gulp.src('./src/js/electron_main.js', {base: './src/js/'})
        .pipe(ifElse(PRODUCTION, () => minifier()))
        .pipe(gulp.dest(`./build/${BRAND_TARGET}/${BUILD_TARGET}`))
        .pipe(size(_extend({title: 'electron-main'}, sizeOptions)))
        .pipe(ifElse(isWatching, livereload))
})

gulp.task('js-electron-webview', 'Generate electron webview js.', jsEntry('electron_webview'))
gulp.task('js-vendor', 'Generate third-party vendor js.', jsEntry('vendor'))
gulp.task('js-webext', 'Generate webextension js.', [], (done) => {
    runSequence([
        'js-webext-bg',
        'js-webext-callstatus',
        'js-webext-observer',
        'js-webext-options',
        'js-webext-popup',
        'js-webext-tab',
    ], `manifest-webext-${BUILD_TARGET}`, () => {
        if (isWatching) livereload.changed('web.js')
        done()
    })
})
gulp.task('js-webext-bg', 'Generate the extension background entry js.', jsEntry('webext_bg'))
gulp.task('js-webext-callstatus', 'Generate the callstatus entry js.', jsEntry('webext_callstatus'))
gulp.task('js-webext-observer', 'Generate webextension observer js that runs in all tab frames.', jsEntry('webext_observer'))
gulp.task('js-webext-options', 'Generate webextension options js.', jsEntry('webext_options'))
gulp.task('js-webext-popup', 'Generate webextension popup/popout js.', jsEntry('webext_popup'))
gulp.task('js-webext-tab', 'Generate webextension tab js.', jsEntry('webext_tab'))


gulp.task('manifest-webext-chrome', 'Generate a web-extension manifest for Chrome.', async() => {
    let manifest = getManifest()
    manifest.options_ui.chrome_style = false
    const manifestTarget = path.join(__dirname, 'build', BRAND_TARGET, BUILD_TARGET, 'manifest.json')
    await writeFileAsync(manifestTarget, JSON.stringify(manifest, null, 4))
})


gulp.task('manifest-webext-firefox', 'Generate a web-extension manifest for Firefox.', async() => {
    let manifest = getManifest()
    manifest.options_ui.browser_style = true
    manifest.applications = {
        gecko: VIALER_SETTINGS.firefox.gecko,
    }
    const manifestTarget = path.join(__dirname, 'build', BRAND_TARGET, BUILD_TARGET, 'manifest.json')
    await writeFileAsync(manifestTarget, JSON.stringify(manifest, null, 4))
})


gulp.task('scss', 'Compile all css.', [], (done) => {
    runSequence([
        'scss-webext',
        'scss-webext-callstatus',
        'scss-webext-options',
        'scss-webext-print',
    ], () => {
        // Targetting webext.css for livereload changed only works in the
        // webview. In the callstatus html, it will trigger a page reload.
        if (isWatching) livereload.changed('webext.css')
        done()
    })
})


gulp.task('scss-webext', 'Generate popover webextension css.', scssEntry('webext'))
gulp.task('scss-webext-callstatus', 'Generate webextension callstatus dialog css.', scssEntry('webext_callstatus'))
gulp.task('scss-webext-options', 'Generate webextension options css.', scssEntry('webext_options'))
gulp.task('scss-webext-print', 'Generate webextension print css.', scssEntry('webext_print'))


gulp.task('watch', 'Start development server and watch for changes.', () => {
    const app = connect()
    isWatching = true
    livereload.listen({silent: false})
    app.use(serveStatic(path.join(__dirname, 'build')))
    app.use('/', serveIndex(path.join(__dirname, 'build'), {icons: false}))
    app.use(mount('/docs', serveStatic(path.join(__dirname, 'docs', 'build'))))
    http.createServer(app).listen(8999)

    // Watch files related to working on the documentation.
    if (WITHDOCS) {
        gutil.log('Watching documentation')
        gulp.watch([
            path.join(__dirname, '.jsdoc.json'),
            path.join(__dirname, 'README.md'),
            path.join(__dirname, 'docs', 'manuals', '**'),
        ], () => {
            gulp.start('docs')
        })
    }

    // Watch files related to working on the webextension.
    gulp.watch([
        path.join(__dirname, 'src', 'js', '**', '*.js'),
        `!${path.join(__dirname, 'src', 'js', 'lib', 'thirdparty', '**', '*.js')}`,
        `!${path.join(__dirname, 'src', 'js', 'vendor.js')}`,
        `!${path.join(__dirname, 'src', 'js', 'electron_main.js')}`,
        `!${path.join(__dirname, 'src', 'js', 'electron_webview.js')}`,
    ], () => {
        if (BUILD_TARGET === 'electron') gulp.start('js-electron')
        else gulp.start('js-webext')

        if (WITHDOCS) gulp.start('docs')
    })

    gulp.watch(path.join(__dirname, 'src', 'js', 'vendor.js'), ['js-vendor'])

    if (BUILD_TARGET !== 'electron') {
        gulp.watch(path.join(__dirname, 'src', 'manifest.json'), [`manifest-webext-${BUILD_TARGET}`])
        gulp.watch(path.join(__dirname, 'src', 'brand.json'), ['build'])
    }


    // Watch files related to working on linked packages.
    if (WATCHLINKED) {
        gutil.log('Watching linked development packages')
        gulp.watch([
            path.join(NODE_PATH, 'jsdoc-rtd', 'static', 'styles', '*.css'),
            path.join(NODE_PATH, 'jsdoc-rtd', 'static', 'js', '*.js'),
            path.join(NODE_PATH, 'jsdoc-rtd', 'publish.js'),
            path.join(NODE_PATH, 'jsdoc-rtd', 'tmpl', '**', '*.tmpl'),
        ], ['docs'])
    }

    // Watch files related to working on assets.
    gulp.watch([
        path.join(__dirname, 'src', '_locales', '**', '*.json'),
        path.join(__dirname, 'src', 'js', 'lib', 'thirdparty', '**', '*.js'),
    ], ['assets'])

    // Watch files related to working on the html and css.
    gulp.watch(path.join(__dirname, 'src', 'html', '**', '*.html'), ['html'])
    gulp.watch(path.join(__dirname, 'src', 'scss', '**', '*.scss'), ['scss'])
})
