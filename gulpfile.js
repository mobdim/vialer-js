const {_extend, promisify} = require('util')
const fs = require('fs')
const path = require('path')
const addsrc = require('gulp-add-src')
const argv = require('yargs').argv
const childExec = require('child_process').exec
const del = require('del')
const flatten = require('gulp-flatten')
const ghPages = require('gulp-gh-pages')
const gulp = require('gulp-help')(require('gulp'), {})
const gutil = require('gulp-util')
const Helpers = require('./gulp/helpers')
const livereload = require('gulp-livereload')
const ifElse = require('gulp-if-else')
const imagemin = require('gulp-imagemin')
const mkdirp = require('mkdirp')
const replace = require('gulp-replace')
const rc = require('rc')
const runSequence = require('run-sequence')
const size = require('gulp-size')
const zip = require('gulp-zip')

const writeFileAsync = promisify(fs.writeFile)
// The main settings object containing info
// from .vialer-jsrc and build flags.
let settings = {}

settings.BRAND_TARGET = argv.brand ? argv.brand : 'vialer'
settings.BUILD_DIR = process.env.BUILD_DIR || path.join(__dirname, 'build')
settings.BUILD_TARGET = argv.target ? argv.target : 'chrome'
settings.BUILD_TARGETS = ['chrome', 'firefox', 'electron', 'webview']
// Exit when the build target is not in the allowed list.
if (!settings.BUILD_TARGETS.includes(settings.BUILD_TARGET)) {
    gutil.log(`Invalid build target: ${settings.BUILD_TARGET}`)
    process.exit(0)
}

settings.DEPLOY_TARGET = argv.deploy ? argv.deploy : 'beta'
// Exit when the deploy target is not in the allowed list.
if (!['production', 'beta'].includes(settings.DEPLOY_TARGET)) {
    gutil.log(`Invalid deployment target: '${settings.DEPLOY_TARGET}'`)
    process.exit(0)
}
settings.LIVERELOAD = false
settings.NODE_PATH = path.join(__dirname, 'node_modules') || process.env.NODE_PATH
settings.PACKAGE = require('./package')
settings.SRC_DIR = path.join(__dirname, 'src')
settings.SIZE_OPTIONS = {showFiles: true, showTotal: true}
settings.VERBOSE = argv.verbose ? true : false

// Force production mode when running certain tasks from
// the commandline. Use this with care.
if (['deploy', 'build-dist'].includes(argv._[0])) {
    settings.PRODUCTION = true
    // Force NODE_ENV to production for envify.
    process.env.NODE_ENV = 'production'
} else {
    // Production mode is on when NODE_ENV environmental var is set.
    settings.PRODUCTION = argv.production ? argv.production : (process.env.NODE_ENV === 'production')

    if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development'
}

settings.NODE_ENV = process.env.NODE_ENV





// Loads the Vialer settings from ~/.vialer-jsrc into the
// existing settings object.
rc('vialer-js', settings)


// Simple brand validation checks.
if (!settings.brands[settings.BRAND_TARGET]) {
    gutil.log(`(!) Brand ${settings.BRAND_TARGET} does not exist. Check vialer-jsrc.`)
    process.exit(0)
}
for (let brand in settings.brands) {
    try {
        fs.statSync(`./src/brand/${brand}`)
    } catch (err) {
        gutil.log(`(!) Brand directory is missing for brand "${brand}"`)
        process.exit(0)
    }
}
// Initialize the helpers, which make this file less dense.
const helpers = new Helpers(settings)


const WATCHLINKED = argv.linked ? argv.linked : false
const WITHDOCS = argv.docs ? argv.docs : false

let taskOptions = {}
if (settings.VERBOSE) {
    taskOptions = {
        all: {
            'brand=vialer': '',
            'target=chrome': 'chrome|firefox|electron|webview',
        },
        brandOnly: {
            'brand=vialer': '',
        },
        browser: {
            'brand=vialer': '',
            'target=chrome': 'chrome|firefox',
        },
        webview: {
            'brand=vialer': '',
            'target=chrome': 'electron|webview',
        },
    }
}




// Notify developer about some essential build flag values.
gutil.log('BUILD FLAGS:')
gutil.log(`- TARGET: ${settings.BUILD_TARGET}`)
gutil.log(`- BRAND: ${settings.BRAND_TARGET}`)
gutil.log(`- DEPLOY: ${settings.DEPLOY_TARGET}`)
gutil.log(`- PRODUCTION: ${settings.PRODUCTION}`)
// ENDOF: Build flags definition.


gulp.task('assets', 'Copy (branded) assets to the build directory.', () => {
    const robotoPath = path.join(settings.NODE_PATH, 'roboto-fontface', 'fonts', 'roboto')
    return gulp.src(path.join(robotoPath, '{Roboto-Light.woff2,Roboto-Regular.woff2,Roboto-Medium.woff2}'))
        .pipe(addsrc(path.join(settings.SRC_DIR, 'fonts', '*'), {base: settings.SRC_DIR}))
        .pipe(flatten({newPath: './fonts'}))
        .pipe(addsrc(`./src/brand/${settings.BRAND_TARGET}/img/{*.png,*.jpg}`, {base: `./src/brand/${settings.BRAND_TARGET}/`}))
        .pipe(ifElse(settings.PRODUCTION, imagemin))
        .pipe(addsrc('./LICENSE'))
        .pipe(addsrc('./README.md'))
        .pipe(addsrc('./src/_locales/**', {base: './src/'}))
        .pipe(addsrc('./src/js/lib/thirdparty/**/*.js', {base: './src/'}))
        .pipe(gulp.dest(`./build/${settings.BRAND_TARGET}/${settings.BUILD_TARGET}`))
        .pipe(size(_extend({title: 'assets'}, settings.SIZE_OPTIONS)))
        .pipe(ifElse(settings.LIVERELOAD, livereload))
}, {options: taskOptions.all})


gulp.task('build', 'Make a branded unoptimized development build.', (done) => {
    // Refresh the brand content with each build.
    let targetTasks
    if (settings.BUILD_TARGET === 'electron') targetTasks = ['js-electron-main', 'js-webview', 'js-vendor']
    else if (settings.BUILD_TARGET === 'webview') targetTasks = ['js-webview', 'js-vendor']
    else targetTasks = ['js-vendor', 'js-webext']

    runSequence(['assets', 'html', 'scss'].concat(targetTasks), done)
}, {options: taskOptions.all})


gulp.task('build-all-targets', 'Build all targets.', (done) => {
    // Refresh the brand content with each build.
    let electronTargetTasks = ['assets', 'html', 'scss', 'js-electron-main', 'js-webview', 'js-vendor']
    let pluginTargetTasks = ['assets', 'html', 'scss', 'js-vendor', 'js-webext']
    settings.BUILD_TARGET = 'chrome'
    runSequence(pluginTargetTasks, () => {
        settings.BUILD_TARGET = 'firefox'
        runSequence(pluginTargetTasks, () => {
            settings.BUILD_TARGET = 'electron'
            runSequence(electronTargetTasks, () => {
                done()
            })
        })
    })
})


gulp.task('build-clean', 'Clear the build directory', async() => {
    await del([path.join(settings.BUILD_DIR, settings.BRAND_TARGET, settings.BUILD_TARGET, '**')], {force: true})
    mkdirp(path.join(settings.BUILD_DIR, settings.BRAND_TARGET, settings.BUILD_TARGET))
}, {options: taskOptions.all})


gulp.task('build-dist', 'Make an optimized build and generate a WebExtension zip file from it.', (done) => {
    const buildDir = `./build/${settings.BRAND_TARGET}/${settings.BUILD_TARGET}`
    runSequence('build', async function() {
        // Use the web-ext build method here, so the result will match
        // the deployable version as closely as possible.
        if (settings.BUILD_TARGET === 'firefox') {
            const source = `--source-dir ${buildDir}`
            const artifacts = `--artifacts-dir ./dist/${settings.BRAND_TARGET}/${settings.BUILD_TARGET}/`
            let execCommand = `web-ext build --overwrite-dest ${source} ${artifacts}`
            let child = childExec(execCommand, undefined, (err, stdout, stderr) => {
                if (stderr) gutil.log(stderr)
                if (stdout) gutil.log(stdout)
                done()
            })

            child.stdout.on('data', (data) => {
                process.stdout.write(`${data.toString()}\r`)
            })
        } else {
            gulp.src([`${buildDir}/**`], {base: buildDir})
                .pipe(zip(helpers.distributionName(settings.BRAND_TARGET)))
                .pipe(gulp.dest(`./dist/${settings.BRAND_TARGET}/${settings.BUILD_TARGET}/`))
                .on('end', done)
        }
    })
}, {options: taskOptions.all})


gulp.task('build-run', 'Make a development build and run it in the target environment.', () => {
    let command = `gulp build --target ${settings.BUILD_TARGET} --brand ${settings.BRAND_TARGET}`
    const buildDir = `./build/${settings.BRAND_TARGET}/${settings.BUILD_TARGET}`
    if (settings.BUILD_TARGET === 'chrome') command = `${command};chromium --user-data-dir=/tmp/vialer-js --load-extension=${buildDir} --no-first-run`
    else if (settings.BUILD_TARGET === 'firefox') command = `${command};web-ext run --no-reload --source-dir ${buildDir}`
    else if (settings.BUILD_TARGET === 'electron') {
        command = `${command};electron --js-flags='--harmony-async-await' ${buildDir}/main.js`
    } else if (settings.BUILD_TARGET === 'webview') {
        helpers.startDevServer()
        const urlTarget = `http://localhost:8999/${settings.BRAND_TARGET}/webview/index.html`
        command = `${command};chromium --user-data-dir=/tmp/vialer-js --disable-web-security --new-window ${urlTarget}`
    }
    childExec(command, undefined, (err, stdout, stderr) => {
        if (err) gutil.log(err)
    })
}, {options: taskOptions.all})


gulp.task('deploy', 'Deploy a build to a store.', async() => {
    await helpers.deploy(settings.BRAND_TARGET, settings.BUILD_TARGET, helpers.distributionName(settings.BRAND_TARGET))
}, {options: taskOptions.browser})


gulp.task('deploy-brand', 'Deploy a brand to all stores.', async() => {
    await helpers.deploy(settings.BRAND_TARGET, 'chrome', helpers.distributionName(settings.BRAND_TARGET))
    await helpers.deploy(settings.BRAND_TARGET, 'firefox', helpers.distributionName(settings.BRAND_TARGET))
}, {options: taskOptions.brandOnly})


gulp.task('deploy-brands', 'Deploy all brands to all stores.', async() => {
    let chromeActions = settings.brands.filter((brand) => helpers.deploy(brand, 'chrome', helpers.distributionName(brand)))
    let firefoxActions = settings.brands.filter((brand) => helpers.deploy(brand, 'firefox', helpers.distributionName(brand)))
    await Promise.all(chromeActions.concat(firefoxActions))
})


gulp.task('docs', 'Generate docs.', (done) => {
    let execCommand = `node ${settings.NODE_PATH}/jsdoc/jsdoc.js ./src/js -R ./README.md -c ./.jsdoc.json -d ${settings.BUILD_DIR}/docs --package ./package.json`
    childExec(execCommand, undefined, (err, stdout, stderr) => {
        if (stderr) gutil.log(stderr)
        if (stdout) gutil.log(stdout)
        if (settings.LIVERELOAD) livereload.changed('rtd.js')
        done()
    })
})


gulp.task('docs-deploy', 'Publish docs on github pages.', ['docs'], () => {
    return gulp.src(`${settings.BRAND_TARGET}/${settings.BUILD_DIR}/docs/**/*`).pipe(ghPages())
})


gulp.task('html', 'Preprocess and build application HTML.', () => {
    let jsbottom, jshead, target

    if (['electron', 'webview'].includes(settings.BUILD_TARGET)) {
        target = 'electron'
        jshead = '<script src="js/lib/thirdparty/SIPml-api.js"></script>'
        jsbottom = '<script src="js/webview.js"></script>'

    } else {
        target = 'webext'
        jshead = ''
        jsbottom = '<script src="js/webext_popup.js"></script>'
    }

    // The index.html file is shared with the electron build target.
    // Appropriate scripts are inserted based on the build target.
    return gulp.src(path.join('src', 'html', 'index.html'))
        .pipe(replace('<!--JSBOTTOM-->', jsbottom))
        .pipe(replace('<!--JSHEAD-->', jshead))
        .pipe(flatten())
        .pipe(ifElse((target === 'webext'), () => addsrc(path.join('src', 'html', 'webext_{options,callstatus}.html'))))
        .pipe(gulp.dest(`./build/${settings.BRAND_TARGET}/${settings.BUILD_TARGET}`))
        .pipe(ifElse(settings.LIVERELOAD, livereload))
}, {options: taskOptions.all})


gulp.task('js-electron', 'Generate electron js.', (done) => {
    runSequence([
        'js-electron-main',
        'js-webview',
        'js-vendor',
    ], done)
})


gulp.task('js-electron-main', 'Generate electron main thread js.', ['js-webview'], () => {
    return gulp.src('./src/js/main.js', {base: './src/js/'})
        .pipe(gulp.dest(`./build/${settings.BRAND_TARGET}/${settings.BUILD_TARGET}`))
        .pipe(size(_extend({title: 'electron-main'}, settings.SIZE_OPTIONS)))
        .pipe(ifElse(settings.LIVERELOAD, livereload))
})


gulp.task('js-webview', 'Generate webview js.', helpers.jsEntry(settings.BRAND_TARGET, settings.BUILD_TARGET, 'webview'))
gulp.task('js-vendor', 'Generate third-party vendor js.', helpers.jsEntry(settings.BRAND_TARGET, settings.BUILD_TARGET, 'vendor'), {options: taskOptions.all})

gulp.task('js-webext', 'Generate WebExtension js.', [], (done) => {
    runSequence([
        'js-webext-bg',
        'js-webext-callstatus',
        'js-webext-observer',
        'js-webext-options',
        'js-webext-popup',
        'js-webext-tab',
    ], 'manifest-webext', () => {
        if (settings.LIVERELOAD) livereload.changed('web.js')
        done()
    })
}, {options: taskOptions.browser})

gulp.task(
    'js-webext-bg',
    'Generate the extension background entry js.',
    helpers.jsEntry(settings.BRAND_TARGET, settings.BUILD_TARGET, 'webext_bg'), {options: taskOptions.browser})
gulp.task(
    'js-webext-callstatus',
    'Generate the callstatus entry js.',
    helpers.jsEntry(settings.BRAND_TARGET, settings.BUILD_TARGET, 'webext_callstatus'), {options: taskOptions.browser})
gulp.task(
    'js-webext-observer',
    'Generate WebExtension observer js that runs in all tab frames.',
    helpers.jsEntry(settings.BRAND_TARGET, settings.BUILD_TARGET, 'webext_observer'), {options: taskOptions.browser})

gulp.task(
    'js-webext-options',
    'Generate webextension options js.',
    helpers.jsEntry(settings.BRAND_TARGET, settings.BUILD_TARGET, 'webext_options'), {options: taskOptions.browser})
gulp.task(
    'js-webext-popup',
    'Generate webextension popup/popout js.',
    helpers.jsEntry(settings.BRAND_TARGET, settings.BUILD_TARGET, 'webext_popup'), {options: taskOptions.browser})
gulp.task(
    'js-webext-tab',
    'Generate webextension tab js.',
    helpers.jsEntry(settings.BRAND_TARGET, settings.BUILD_TARGET, 'webext_tab'), {options: taskOptions.browser})


gulp.task('manifest-webext', 'Generate a manifest for a browser WebExtension.', async() => {
    let manifest = helpers.getManifest(settings.BRAND_TARGET, settings.BUILD_TARGET)
    const manifestTarget = path.join(__dirname, 'build', settings.BRAND_TARGET, settings.BUILD_TARGET, 'manifest.json')
    await writeFileAsync(manifestTarget, JSON.stringify(manifest, null, 4))
}, {options: taskOptions.browser})


gulp.task('scss', 'Compile all css.', [], (done) => {
    runSequence([
        'scss-webext',
        'scss-webext-callstatus',
        'scss-webext-options',
        'scss-webext-print',
    ], () => {
        // Targetting webext.css for livereload changed only works in the
        // webview. In the callstatus html, it will trigger a page reload.
        if (settings.LIVERELOAD) livereload.changed('webext.css')
        done()
    })
}, {options: taskOptions.all})


gulp.task(
    'scss-webext', 'Generate popover webextension css.',
    helpers.scssEntry(settings.BRAND_TARGET, settings.BUILD_TARGET, 'webext'), {options: taskOptions.all})
gulp.task(
    'scss-webext-callstatus', 'Generate webextension callstatus dialog css.',
    helpers.scssEntry(settings.BRAND_TARGET, settings.BUILD_TARGET, 'webext_callstatus'), {options: taskOptions.all})
gulp.task(
    'scss-webext-options', 'Generate webextension options css.',
    helpers.scssEntry(settings.BRAND_TARGET, settings.BUILD_TARGET, 'webext_options'), {options: taskOptions.all})
gulp.task(
    'scss-webext-print', 'Generate webextension print css.',
    helpers.scssEntry(settings.BRAND_TARGET, settings.BUILD_TARGET, 'webext_print'), {options: taskOptions.all})

gulp.task('watch', 'Start development server and watch for changes.', () => {
    settings.LIVERELOAD = true
    helpers.startDevServer()

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
        `!${path.join(__dirname, 'src', 'js', 'main.js')}`,
        `!${path.join(__dirname, 'src', 'js', 'webview.js')}`,
    ], () => {
        if (settings.BUILD_TARGET === 'electron') gulp.start('js-electron')
        else gulp.start('js-webext')

        if (WITHDOCS) gulp.start('docs')
    })

    gulp.watch(path.join(__dirname, 'src', 'js', 'vendor.js'), ['js-vendor'])

    if (!['electron', 'webview'].includes(settings.BUILD_TARGET)) {
        gulp.watch(path.join(__dirname, 'src', 'manifest.json'), ['manifest-webext'])
        gulp.watch(path.join(__dirname, 'src', 'brand.json'), ['build'])
    }

    // Watch files related to working on linked packages.
    if (WATCHLINKED) {
        gutil.log('Watching linked development packages')
        gulp.watch([
            path.join(settings.NODE_PATH, 'jsdoc-rtd', 'static', 'styles', '*.css'),
            path.join(settings.NODE_PATH, 'jsdoc-rtd', 'static', 'js', '*.js'),
            path.join(settings.NODE_PATH, 'jsdoc-rtd', 'publish.js'),
            path.join(settings.NODE_PATH, 'jsdoc-rtd', 'tmpl', '**', '*.tmpl'),
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
