module.exports = (app) => {

    return {
        computed: {
            filteredContacts: function() {
                let searchQuery = this.module.search.input.toLowerCase()
                return this.module.contacts.filter(function(contact) {
                    let name = contact.callerid_name.toLowerCase()
                    let description = contact.description.toLowerCase()
                    if (!name.includes(searchQuery) && !description.includes(searchQuery)) {
                        return false
                    }

                    return true
                })
            },
            widgetState: function() {
                let state = {
                    active: this.module.widget.active,
                    inactive: !this.module.widget.active,
                }

                state[this.module.widget.state] = true
                return state
            },
        },
        methods: {
            callContact: function(contact) {
                let forceSilent = false
                if (app.env.isExtension && app.env.role.popout) forceSilent = true

                app.emit('dialer:dial', {
                    analytics: 'Colleagues',
                    b_number: contact.internal_number,
                    forceSilent: forceSilent,
                })
            },
            toggleActive: function(widgetName) {
                // Switch all widgets off, except the current one.
                for (let moduleName of Object.keys(this.$store)) {
                    if (moduleName !== widgetName && 'widget' in this.$store[moduleName]) {
                        this.$store[moduleName].widget.active = false
                    }
                }
                this.module.widget.active = !this.module.widget.active
            },
        },
        render: templates.contacts.r,
        staticRenderFns: templates.contacts.s,
        store: {
            module: 'contacts',
        },
    }
}
