# homebridge-generic-avr

Homebridge plugin for AV Receivers
For Onkyo AV Receivers, should work for all supported models as listed in the node_modules/eiscp/eiscp-commands.json. If your model is not listed, try TX-NR609.

# Description

This is an enhanced fork from homebridge-onkyo plugin written by ToddGreenfield
The goal is to add supports for other brand AV receivers, such as Denon

# Changelog

* Version 0.1.0 Initial refactor the code

# To Do

Add Denon support
Others...

# Installation

For Onkyo AV Receiver, ensure that it is controllable using the OnkyoRemote3 iOS app.
You also need to have [git](https://github.com/git/git) installed.

It is recommended to install and configure this plugin using [homebridge-config-ui-x](https://github.com/oznu/homebridge-config-ui-x#readme), however you can also install manually using the following manual tasks:

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-onkyo
3. Update your configuration file. See the sample below.

# Configuration

Example accessory config (needs to be added to the homebridge config.json):
 ```
"platforms": [{
        "platform": "GenericAVR",
        "receivers": [
            {
                "vendor": "Onkyo",
                "model": "TX-NR609",
                "ip_address": "10.0.0.46",
                "poll_status_interval": "3000",
                "name": "Receiver",
                "zone": "main",
                "default_input": "net",
                "default_volume": "10",
                "max_volume": "40",
                "map_volume_100": false,
                "inputs": [
                    {"input_name": "dvd", "display_name": "Blu-ray"},
                    {"input_name": "video2", "display_name": "Switch"},
                    {"input_name": "video3", "display_name": "Wii U"},
                    {"input_name": "video6", "display_name": "Apple TV"},
                    {"input_name": "video4", "display_name": "AUX"},
                    {"input_name": "cd", "display_name": "TV/CD"}
                ],
                "volume_dimmer": false,
                "switch_service": false,
                "filter_inputs": true
            }
        ]
    }]
 ```
### Config Explanation:

Field           			| Description
----------------------------|------------
**platform**   			| (required) Must always be "GenericAVR".
**receivers**               | (required) List of receiver accessories to create. Must contain at least 1.
Receiver Attributes         |
----------------------------|------------
**vendor**                 | (required) Current supported values are: Onkyo
**name**					| (required) The name you want to use for control of the AVR accessories.
**ip_address**  			| (required) The internal ip address of your AVR.
**model**					| (required) Must be a valid model listed in config.schema.json file. If your model is not listed, you can use the TX-NR609 if your model supports the Integra Serial Communication Protocol (ISCP).
**poll_status_interval**  	| (optional) Poll Status Interval. Defaults to 0 or no polling.
**default_input**  			| (optional) A valid source input. Default will use last known input. See output of 3.js in eiscp/examples for options.
**default_volume**  		| (optional) Initial receiver volume upon powerup. This is the true volume number, not a percentage. Ignored if powerup from device knob or external app (like OnkyoRemote3).
**max_volume**  			| (optional) Receiver volume max setting. This is a true volume number, not a percentage, and intended so there is not accidental setting of volume to 80. Ignored by external apps (like OnkyoRemote3). Defaults to 30.
**map_volume_100**  		| (optional) Will remap the volume percentages that appear in the Home app so that the configured max_volume will appear as 100% in the Home app. For example, if the max_volume is 30, then setting the volume slider to 50% would set the receiver's actual volume to 15. Adjusting the stereo volume knob to 35 will appear as 100% in the Home app. This option could confuse some users to it defaults to off false, but it does give the user finer volume control especially when sliding volume up and down in the Home app. Defaults to False.
**zone**              		| (optional) Defaults to main. Optionally control zone2 where supported.
**inputs**					| (optional) List of inputs you want populated for the TV service and what you want them to be displayed as.
**filter_inputs**                   | (optional) Boolean value. Setting this to `true` limits inputs displayed in HomeKit to those you provide in `inputs`. If `false` or not defined, all inputs supported by `model` will be displayed.
**volume_dimmer**					| (optional) Boolean value. Setting this to `false` disables additional Dimmer accessory for separate volume control.


# Troubleshooting

Todo

