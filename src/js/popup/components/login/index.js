module.exports = (app) => {
    return {
        render: templates.login.r,
        staticRenderFns: templates.login.s,
        store: {
            user: 'user',
        },
    }
}
