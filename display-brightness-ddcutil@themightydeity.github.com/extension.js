/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const Main = imports.ui.main
const ByteArray = imports.byteArray
const { Clutter, GObject, St } = imports.gi

// for shell command 
const GLib = imports.gi.GLib

// icons and labels
const Lang = imports.lang

// menu items
const Panel = imports.ui.panel
const PanelMenu = imports.ui.panelMenu
const PopupMenu = imports.ui.popupMenu
const Slider = imports.ui.slider

let panelmenu, icon
let brightnessIcon = 'display-brightness-symbolic'

/* lowest possible value for brightness */
const minBrightness = 1

/* when should min brightness value should be used */
const minBrightnessThreshold = 5

let displays = []

/* exported init */

class Extension {
    constructor() {
    }

    enable() {
        SliderPanelMenu("enable")
    }

    disable() {
        SliderPanelMenu("disable")
    }
}

function init() {
    return new Extension()
}

function spawnCommandAndRead(command_line) {
    try {
        let stuff = ByteArray.toString(GLib.spawn_command_line_sync(command_line)[1])
        return stuff
    } catch (err) {
        return null
    }
}
const SliderMenuItem = GObject.registerClass(
    {
        GType: 'SliderMenuItem'
    }, class SliderMenuItem extends PopupMenu.PopupMenuItem {
    _init(slider) {
        super._init("")
        this.add_child(slider)
    }
})

const SliderPanelMenuButton = GObject.registerClass(
    {
        GType: 'SliderPanelMenuButton'
    }, class SliderPanelMenuButton extends PanelMenu.Button {
    _init() {
        super._init(0.0)
        icon = new St.Icon({ icon_name: brightnessIcon, style_class: 'system-status-icon' })
        this.menu.connect('open-state-changed', this._onOpenStateChanged.bind(this))
        this.add_actor(icon)
    }
    removeAllMenu() {
        this.menu.removeAll()
    }
    addMenuItem(item) {
        this.menu.addMenuItem(item)
    }
    _onOpenStateChanged(menu, open) {
        updateSliderForAllDisplays()
    }
})

class SliderItem extends PopupMenu.PopupMenuSection {
    constructor(display, onSliderChange) {
        super()
        this._onSliderChange = onSliderChange
        this._init(display)
    }
    _init(display) {
        this.NameContainer = new PopupMenu.PopupMenuItem(display.name, { hover: false, reactive: false, can_focus: false })

        this.ValueSlider = new Slider.Slider(display.current / display.max)
        this.ValueSlider.connect('notify::value', () => this._SliderChange())
        display.slider = this.ValueSlider

        this.SliderContainer = new SliderMenuItem(this.ValueSlider)

        // add Slider to it
        this.addMenuItem(this.NameContainer)
        this.addMenuItem(this.SliderContainer)
        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
    }
    _SliderChange() {
        let sliderval = parseInt(this.ValueSlider.value * 100)
        this._onSliderChange(sliderval)
    }
}
function updateSliderForAllDisplays(){
    /* fetch the current brightness state of monitors and update slider when menu is closed */
    displays.forEach(function(display) {
        updateSliderWithCurrentBrightnessValue(display).then((display)=>{
            /* function to fetch current brightness 
            from monitor the and populate the slider */
            display.triggerUpdateToDevice = false
            display.slider.value = (display.current / display.max)
            display.triggerUpdateToDevice = true
        },()=>{

        })
    })
}
function updateSliderWithCurrentBrightnessValue(display) {
    return new Promise((resolve, reject) => {
        if (display.slider) {
            getDisplayBrightness(display)
            resolve(display)
        }else{
            reject(display)
        }
    })
}
function getDisplayBrightness(display) {
    /* read the current and max brightness using getvcp 10 */
    let vcpInfos = spawnCommandAndRead("ddcutil getvcp --nodetect --brief 10 --bus " + display.bus)
    let vcpInfosArray = vcpInfos.trim().split(" ")
    let maxBrightness = parseInt(vcpInfosArray[4])
    let currentBrightness = parseInt((parseInt(vcpInfosArray[3]) / maxBrightness) * 100)
    display.max = maxBrightness
    display.current = currentBrightness
}

function getDisplays() {
    displays = []
    return new Promise((resolve, reject) => {
        let ddc_output = spawnCommandAndRead("ddcutil detect --brief")
        if (ddc_output && ddc_output !== "") {
            let ddc_lines = ddc_output.split('\n')
            let display = {}
            for (let i = 0; i < ddc_lines.length; i++) {
                let ddc_line = ddc_lines[i]
                if (ddc_line.indexOf("/dev/i2c-") !== -1) {
                    /* I2C bus comes first, so when that is detect start a new display object */
                    let display_bus = ddc_line.split("/dev/i2c-")[1].trim()
                    /* make display object */
                    display = { bus: display_bus, max: null, current: null, slider: null, triggerUpdateToDevice: true, name: "" }
                    getDisplayBrightness(display)
                }
                if (ddc_line.indexOf("Monitor:") !== -1) {
                    /* Monitor name comes second, so when that is detected fill the object and push it to list */
                    display.name = ddc_line.split("Monitor:")[1].trim().split(":")[1].trim()
                    displays.push(display)
                }
            }
        }
        if (displays.length > 0) {
            global.log("found displays 1")
            resolve(displays)
        } else {
            reject()
        }
    })
}
function setBrightness(display, newValue) {
    if (display.triggerUpdateToDevice) {
        let newBrightness = parseInt((newValue / 100) * display.max)
        if (newBrightness <= minBrightnessThreshold) {
            newBrightness = minBrightness
        }
        GLib.spawn_command_line_async("ddcutil setvcp 10 " + newBrightness + " --nodetect --bus " + display.bus)
    }
}
function SliderPanelMenu(set) {
    if (set == "enable") {
        panelmenu = new SliderPanelMenuButton()
        Main.panel.addToStatusArea("BrightnessSlider", panelmenu, 0, "right")
        panelmenu.removeAllMenu()
        getDisplays().then((displays) => {
            global.log("found displays 3")
            displays.forEach((display) => {
                let onSliderChange = function (newValue) {
                    setBrightness(display, newValue)
                }
                let displaySlider = new SliderItem(display, onSliderChange)
                panelmenu.addMenuItem(displaySlider)
            })
        }, () => {
            global.error("ddcutil didn't find any display.")
        })
    } else if (set == "disable") {
        panelmenu.destroy()
        panelmenu = null
        icon = null
    }
}