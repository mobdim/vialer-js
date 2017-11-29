module.exports = (app) => {

    return {
        computed: {
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
        render: templates.availability.r,
        staticRenderFns: templates.availability.s,
        store: {
            module: 'availability',
        },
        watch: {
            'module.available': function(newVal, oldVal) {
                let selectedType = null
                let selectedId = null

                if (newVal === 'yes') {
                    [selectedType, selectedId] = this.module.destinations.selected.split('-')
                }

                app.emit('availability.update', {id: selectedId, type: selectedType})
            },
            'module.destinations.selected': function(newVal, oldVal) {
                let [selectedType, selectedId] = this.module.destinations.selected.split('-')
                app.emit('availability.update', {id: selectedId, type: selectedType})
            },
        },
    }
}
