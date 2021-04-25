'use strict';

let Service;
let Characteristic;
const pollingtoevent = require('polling-to-event');
const info = require('./package.json');
const importFresh = require('import-fresh')

class GenericAvrPlatform {
	constructor(log, config, api) {
		var that = this;

		that.reachable = false
		this.api = api;
		this.config = config;
		this.log = log;
		this.receivers = [];
		this.receiverAccessories = [];
		this.connections = {};

		that.log.info('**************************************************************')
		that.log.info('  homebridge-generic-avr version ' + info.version)
		that.log.info('  GitHub: https://github.com/hlyi/homebridge-generic-avr')
		that.log.info('**************************************************************')
		that.log.info('start success...');
		that.log.debug('Debug mode enabled');

		if (typeof config.receivers === 'undefined' ) {
			that.log.error('ERROR: your configuration is incorrect. Configuration changed with version 0.7.x');
			that.receivers = [];
		}else{
			config['receivers'].forEach ( (receiver, i) => {
				let recvidx = i+1
				if ( typeof receiver.vendor === 'undefined') {
					that.log.error('Missing vendor in receiver ' + recvidx + '\'s configuration')
				}else if ( receiver.vendor in vendors ){
					if ( typeof receiver.name === 'undefined' ) {
						that.log.error('Missing name in receiver ' + recvidx + '\'s configuration');
					}else if ( typeof receiver.ip_address === 'undefined' ) {
						that.log.error('Missing IP address in receiver ' + recvidx + '\'s configuration');
					}else {
						that.receivers.push(receiver)
					}
				}else {
					that.log.error('Unsupported vendor : ' + receiver.vendor + ' in receiver ' + recvidx + '\'s configuration')
				}
			});
		}

	}

	accessories (callback) {

		var that = this
		that.foundReceivers = []

		var numReceivers = that.receivers.length
		that.log('Adding %s AVRs', numReceivers)

		that.receivers.forEach ( device => {
			try {
				const accessory = new GenericAvrAccessory(that, device)
				that.foundReceivers.push(accessory)
			}
			catch ( e ) {
				that.log.error( "Can't create AVR : " + device.name + " at " + device.ip_address + " with error: " + e.message)
			}
		})

		that.log('Added %s AVRs', that.foundReceivers.length)
		callback(that.foundReceivers)
	}
}

class GenericAvrAccessory {
	constructor(platform, receiver) {
		var that = this
		this.platform = platform;
		this.log = platform.log;

		this.setAttempt = 0;

		this.config = receiver;
		this.name = this.config.name;
		this.ip_address	= this.config.ip_address;
		this.model = this.config.model;
		this.zone = (this.config.zone || 'main').toLowerCase();

		if (typeof this.config.volume_dimmer === 'undefined') {
			this.log.error('ERROR: Your configuration is missing the parameter "volume_dimmer". Assuming "false".');
			this.volume_dimmer = false;
		} else {
			this.volume_dimmer = this.config.volume_dimmer;
		}

		if (typeof this.config.filter_inputs === 'undefined') {
			this.log.error('ERROR: Your configuration is missing the parameter "filter_inputs". Assuming "false".');
			this.filter_inputs = false;
		} else {
			this.filter_inputs = this.config.filter_inputs;
		}

		this.inputs = this.config.inputs;

		this.poll_status_interval = this.config.poll_status_interval || '0';
		this.defaultInput = this.config.default_input;
		this.defaultVolume = this.config.default_volume;
		this.maxVolume = this.config.max_volume || 60;
		this.mapVolume100 = this.config.map_volume_100 || true;

		this.state = false;
		this.m_state = false;
		this.v_state = 0;
		this.i_state = null;
		this.interval = Number.parseInt(this.poll_status_interval, 10);

		this.avrManufacturer = 'GenericAvr';
		this.avrSerial = this.config.serial || this.ip_address;
		this.switchHandling = 'check';
		if (this.interval > 10 && this.interval < 100000)
			this.switchHandling = 'poll';

		this.log.debug('name %s', this.name);
		this.log.debug('IP %s', this.ip_address);
		this.log.debug('Model %s', this.model);
		this.log.debug('Zone %s', this.zone);
		this.log.debug('volume_dimmer: %s', this.volume_dimmer);
		this.log.debug('filter_inputs: %s', this.filter_inputs);
		this.log.debug('poll_status_interval: %s', this.poll_status_interval);
		this.log.debug('defaultInput: %s', this.defaultInput);
		this.log.debug('defaultVolume: %s', this.defaultVolume);
		this.log.debug('maxVolume: %s', this.maxVolume);
		this.log.debug('mapVolume100: %s', this.mapVolume100);
		this.log.debug('avrSerial: %s', this.avrSerial);

		this.vendor = new vendors[this.config.vendor](this)

		if ( ! this.vendor.createRxInput(this) ) {
			throw new Error('Unsupported Onyko Model-' + this.model );
		}
		// Option to only configure specified inputs with filter_inputs
		if (this.filter_inputs) {
			// Check the RxInputs.Inputs items to see if each exists in this.inputs. Return new array of those that do.
			this.RxInputs.Inputs = this.RxInputs.Inputs.filter(rxinput => {
				return that.inputs.some(input => {
					return input.input_name === rxinput.label;
				});
			});
		}

//		this.createRxInput();
		this.vendor.connectAvr(this);
		this.polling(this);
	}


	getServices () {
		var that = this
		var services = []

		// add basic information
		let	infoAcc = new Service.AccessoryInformation;
		infoAcc
			.setCharacteristic(Characteristic.Manufacturer, this.avrManufacturer)
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.avrSerial)
			.setCharacteristic(Characteristic.FirmwareRevision, info.version)
			.setCharacteristic(Characteristic.Name, this.name);
		services.push( infoAcc );

		// add tv service
		this.log.debug('Creating TV service for receiver %s', this.name);
		this.tvService = new Service.Television( this.name);
		this.tvService
			.getCharacteristic(Characteristic.ConfiguredName)
			.setValue(this.name)
			.setProps({
				perms: [Characteristic.Perms.READ]
			});
		this.tvService
			.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
		this.tvService
			.getCharacteristic(Characteristic.Active)
			.on('get', this.getPowerState.bind(this))
			.on('set', this.setPowerState.bind(this));
		this.tvService
			.getCharacteristic(Characteristic.ActiveIdentifier)
			.on('set', this.setInputSource.bind(this))
			.on('get', this.getInputSource.bind(this));
		this.tvService
			.getCharacteristic(Characteristic.RemoteKey)
			.on('set', this.remoteKeyPress.bind(this));
		services.push( this.tvService)

		// add tv speaker
		this.tvSpeakerService = new Service.TelevisionSpeaker( this.name + ' Volume', 'tvSpeakerService');

		this.tvSpeakerService
			.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
			.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);
		this.tvSpeakerService
			.getCharacteristic(Characteristic.VolumeSelector)
			.on('set', this.setVolumeRelative.bind(this));
		this.tvSpeakerService
			.getCharacteristic(Characteristic.Mute)
			.on('get', this.getMuteState.bind(this))
			.on('set', this.setMuteState.bind(this));
		this.tvSpeakerService
			.addCharacteristic(Characteristic.Volume)
			.on('get', this.getVolumeState.bind(this))
			.on('set', this.setVolumeState.bind(this));
		this.tvService.addLinkedService(this.tvSpeakerService);
		services.push(this.tvSpeakerService)

		// input selector
		// Create final array of inputs, using any labels defined in the config's inputs to override the default labels
		this.RxInputs.Inputs.forEach((i, index) => {
			let inputName = i.label;
			if (that.inputs) {
				that.inputs.forEach(input => {
					if (input.input_name === i.label)
						inputName = input.display_name;
				});
			}
			let input = new Service.InputSource( that.name + ' ' + inputName, i.code);
			input
				.setCharacteristic(Characteristic.Identifier, index + 1 )
				.setCharacteristic(Characteristic.ConfiguredName, inputName)
				.setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
				.setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.HDMI)
				.getCharacteristic(Characteristic.ConfiguredName).setProps({ perms: [Characteristic.Perms.READ] });

			that.tvService.addLinkedService(input);
			services.push(input)
		});

		if (this.volume_dimmer) {
			this.log.debug('Creating Dimmer service linked to TV for receiver %s', this.name);

			this.dimmer = new Service.Lightbulb( this.name + ' Volume', 'dimmer');
			this.dimmer
				.getCharacteristic(Characteristic.On)
				.on('get', callback => {
					this.getMuteState((error, value) => {
							if (error) {
								callback(error);
								return;
							}
							callback(null, !value);
						});
					})
				.on('set', (value, callback) => this.setMuteState(!value, callback));
			this.dimmer
				.addCharacteristic(Characteristic.Brightness)
				.on('get', this.getVolumeState.bind(this))
				.on('set', this.setVolumeState.bind(this));

			this.tvService.addLinkedService(this.dimmer);
		}

		return services
	}

	polling(platform) {
		const that = platform;
	// Status Polling
		if (that.switchHandling === 'poll') {
			// somebody instroduced powerurl but we are never using it.
			// const powerurl = that.status_url;
			that.log.debug('start long poller..');
	// PWR Polling
			const statusemitter = pollingtoevent(done => {
				that.log.debug('start PWR polling..');
				that.getPowerState((error, response) => {
					// pass also the setAttempt, to force a homekit update if needed
					done(error, response, that.setAttempt);
				}, 'statuspoll');
			}, {longpolling: true, interval: that.interval * 1000, longpollEventName: 'statuspoll'});

			statusemitter.on('statuspoll', data => {
				that.state = data;
				that.log.debug('event - PWR status poller - new state: ', that.state);
				// if (that.tvService ) {
				// 	that.tvService.getCharacteristic(Characteristic.Active).updateValue(that.state, null, 'statuspoll');
				// }
			});
	// Audio-Input Polling
			const i_statusemitter = pollingtoevent(done => {
				that.log.debug('start INPUT polling..');
				that.getInputSource((error, response) => {
					// pass also the setAttempt, to force a homekit update if needed
					done(error, response, that.setAttempt);
				}, 'i_statuspoll');
			}, {longpolling: true, interval: that.interval * 1000, longpollEventName: 'i_statuspoll'});

			i_statusemitter.on('i_statuspoll', data => {
				that.i_state = data;
				that.log.debug('event - INPUT status poller - new i_state: ', that.i_state);
				// if (that.tvService ) {
				// 	that.tvService.getCharacteristic(Characteristic.ActiveIdentifier).updateValue(that.i_state, null, 'i_statuspoll');
				// }
			});
	// Audio-Muting Polling
			const m_statusemitter = pollingtoevent(done => {
				that.log.debug('start MUTE polling..');
				that.getMuteState((error, response) => {
					// pass also the setAttempt, to force a homekit update if needed
					done(error, response, that.setAttempt);
				}, 'm_statuspoll');
			}, {longpolling: true, interval: that.interval * 1000, longpollEventName: 'm_statuspoll'});

			m_statusemitter.on('m_statuspoll', data => {
				that.m_state = data;
				that.log.debug('event - MUTE status poller - new m_state: ', that.m_state);
				// if (that.tvService ) {
				// 	that.tvService.getCharacteristic(Characteristic.Mute).updateValue(that.m_state, null, 'm_statuspoll');
				// }
			});
	// Volume Polling
			const v_statusemitter = pollingtoevent(done => {
				that.log.debug('start VOLUME polling..');
				that.getVolumeState((error, response) => {
					// pass also the setAttempt, to force a homekit update if needed
					done(error, response, that.setAttempt);
				}, 'v_statuspoll');
			}, {longpolling: true, interval: that.interval * 1000, longpollEventName: 'v_statuspoll'});

			v_statusemitter.on('v_statuspoll', data => {
				that.v_state = data;
				that.log.debug('event - VOLUME status poller - new v_state: ', that.v_state);
				// if (that.tvService ) {
				// 	that.tvService.getCharacteristic(Characteristic.Volume).updateValue(that.v_state, null, 'v_statuspoll');
				// }
			});
		}
	}

	/// ////////////////
	// EVENT FUNCTIONS
	/// ////////////////
	eventDebug(response) {
		this.log.debug('eventDebug: %s', response);
	}

	eventError(response) {
		this.log.error('eventError: %s', response);
	}

	eventConnect(response) {
		this.log.debug('eventConnect: %s', response);
		this.reachable = true;
	}

	eventSystemPower(setOn) {
		if (this.state !== setOn)
			this.log.info('Event - System Power changed: %s', setOn);

		this.state = setOn
		this.log.debug('eventSystemPower - message: %s, new state %s', setOn, this.state);
		// Communicate status
		if (this.tvService)
			this.tvService.getCharacteristic(Characteristic.Active).updateValue(this.state);
		// if (this.volume_dimmer) {
		// 	this.m_state = !(response == 'on');
		// 	this.dimmer.getCharacteristic(Characteristic.On).updateValue((response == 'on'), null, 'power event m_status');
		// }
	}

	eventAudioMuting(response) {
		this.m_state = (response === 'on');
		this.log.debug('eventAudioMuting - message: %s, new m_state %s', response, this.m_state);
		// Communicate status
		if (this.tvService)
			this.tvService.getCharacteristic(Characteristic.Mute).updateValue(this.m_state, null, 'm_statuspoll');
	}

	eventInput(label) {
		if (label) {
			// Convert to i_state input code
			const index =
				label !== null ? // eslint-disable-line no-negated-condition
				this.RxInputs.Inputs.findIndex(i => i.label === label ) :
				-1;
			if (this.i_state !== (index + 1))
				this.log.info('Event - Input changed: %s', label);

			this.i_state = index + 1;

			this.log.debug('eventInput - new i_state: %s - input: %s', this.i_state, label);
			// this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).updateValue(this.i_state);
		} else {
			// Then invalid Input chosen
			this.log.error('eventInput - ERROR - INVALID INPUT - Model does not support selected input.');
		}

		// Communicate status
		if (this.tvService)
			this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).updateValue(this.i_state);
	}

	eventVolume(response) {
		if (this.mapVolume100) {
			const volumeMultiplier = this.maxVolume / 100;
			const newVolume = response / volumeMultiplier;
			this.v_state = Math.round(newVolume);
			this.log.debug('eventVolume - message: %s, new v_state %s PERCENT', response, this.v_state);
		} else {
			this.v_state = response;
			this.log.debug('eventVolume - message: %s, new v_state %s ACTUAL', response, this.v_state);
		}

		// Communicate status
		if (this.tvService)
			this.tvService.getCharacteristic(Characteristic.Volume).updateValue(this.v_state, null, 'v_statuspoll');
	}

	eventClose(response) {
		this.log.debug('eventClose: %s', response);
		this.reachable = false;
	}

	/// /////////////////////
	// GET AND SET FUNCTIONS
	/// /////////////////////
	setPowerState(powerOn, callback, context) {
		let that = this
	// if context is statuspoll, then we need to ensure that we do not set the actual value
		if (context && context === 'statuspoll') {
			this.log.debug('setPowerState - polling mode, ignore, state: %s', this.state);
			callback(null, this.state);
			return;
		}

		if (!this.ip_address) {
			this.log.error('Ignoring request; No ip_address defined.');
			callback(new Error('No ip_address defined.'));
			return;
		}

		this.setAttempt++;

		// do the callback immediately, to free homekit
		// have the event later on execute changes
		this.state = powerOn;
		callback(null, this.state);
		if (powerOn) {
			this.log.debug('setPowerState - actual mode, power state: %s, switching to ON', this.state);
			this.vendor.setPowerStateOn( error => {
				// this.log.debug( 'PWR ON: %s - %s -- current state: %s', error, response, this.state);
				if (error) {
					this.state = false;
					this.log.error('setPowerState - PWR ON: ERROR - current state: %s', this.state);
					// if (this.tvService ) {
					// 	this.tvService.getCharacteristic(Characteristic.Active).updateValue(powerOn, null, 'statuspoll');
					// }
				} else {
					// If the AVR has just been turned on, apply the default volume
						this.log.debug('Attempting to set the default volume to ' + this.defaultVolume);
						if (powerOn && this.defaultVolume) {
							this.log.info('Setting default volume to ' + this.defaultVolume);
							this.vendor.setVolumeState(this.defaultVolume, error=>{
								if (error)
									this.log.error('Error while setting default volume: %s', error);
							});
						}

					// If the AVR has just been turned on, apply the Input default
						this.log.debug('Attempting to set the default input selector to ' + this.defaultInput);

						// Handle defaultInput being either a custom label or manufacturer label
						let label = this.defaultInput;
						if (this.inputs) {
							this.inputs.forEach(input => {
								if (input.input_name === this.default)
									label = input.input_name;
								else if (input.display_name === this.defaultInput)
									label = input.display_name;
							});
						}

						const index =
							label !== null ? // eslint-disable-line no-negated-condition
							that.RxInputs.Inputs.findIndex(i => i.label === label) :
							-1;
						this.i_state = index + 1;

						if (powerOn && label) {
							this.log.info('Setting default input selector to ' + label);
							this.vendor.setInputSource ( label, error =>{
								if (error)
									this.log.error('Error while setting default input: %s', error);
							});
						}
				}
			});
		} else {
			this.log.debug('setPowerState - actual mode, power state: %s, switching to OFF', this.state);
			this.vendor.setPowerStateOff( error => {
				// this.log.debug( 'PWR OFF: %s - %s -- current state: %s', error, response, this.state);
				if (error) {
					this.state = false;
					this.log.error('setPowerState - PWR OFF: ERROR - current state: %s', this.state);
					// if (this.tvService ) {
					// 	this.tvService.getCharacteristic(Characteristic.Active).updateValue(this.state, null, 'statuspoll');
					// }
				}
			});
		}

		// if (this.volume_dimmer) {
		// 	this.m_state = !(powerOn == 'on');
		// 	this.dimmer.getCharacteristic(Characteristic.On).updateValue((powerOn == 'on'), null, 'power event m_status');
		// }
		this.tvService.getCharacteristic(Characteristic.Active).updateValue(this.state);
	}

	getPowerState(callback, context) {
		// if context is statuspoll, then we need to request the actual value
		if ((!context || context !== 'statuspoll') && this.switchHandling === 'poll') {
				this.log.debug('getPowerState - polling mode, return state: ', this.state);
				callback(null, this.state);
				return;
		}

		if (!this.ip_address) {
			this.log.error('Ignoring request; No ip_address defined.');
			callback(new Error('No ip_address defined.'));
			return;
		}

		// do the callback immediately, to free homekit
		// have the event later on execute changes
		callback(null, this.state);
		this.log.debug('getPowerState - actual mode, return state: ', this.state);
		this.vendor.getPowerState( error => {
			if (error) {
				this.state = false;
				this.log.debug('getPowerState - PWR QRY: ERROR - current state: %s', this.state);
			}
		});
		this.tvService.getCharacteristic(Characteristic.Active).updateValue(this.state);
	}

	getVolumeState(callback, context) {
		// if context is v_statuspoll, then we need to request the actual value
		if ((!context || context !== 'v_statuspoll') && this.switchHandling === 'poll') {
				this.log.debug('getVolumeState - polling mode, return v_state: ', this.v_state);
				callback(null, this.v_state);
				return;
		}

		if (!this.ip_address) {
			this.log.error('Ignoring request; No ip_address defined.');
			callback(new Error('No ip_address defined.'));
			return;
		}

		// do the callback immediately, to free homekit
		// have the event later on execute changes
		callback(null, this.v_state);
		this.log.debug('getVolumeState - actual mode, return v_state: ', this.v_state);
		this.vendor.getVolumeState ( error => {
			if (error) {
				this.v_state = 0;
				this.log.debug('getVolumeState - VOLUME QRY: ERROR - current v_state: %s', this.v_state);
			}
		});

		// Communicate status
		if (this.tvService)
			this.tvSpeakerService.getCharacteristic(Characteristic.Volume).updateValue(this.v_state);
	}

	setVolumeState(volumeLvl, callback, context) {
	// if context is v_statuspoll, then we need to ensure this we do not set the actual value
		if (context && context === 'v_statuspoll') {
			this.log.debug('setVolumeState - polling mode, ignore, v_state: %s', this.v_state);
			callback(null, this.v_state);
			return;
		}

		if (!this.ip_address) {
			this.log.error('Ignoring request; No ip_address defined.');
			callback(new Error('No ip_address defined.'));
			return;
		}

		this.setAttempt++;

		// Are we mapping volume to 100%?
		if (this.mapVolume100) {
			const volumeMultiplier = this.maxVolume / 100;
			const newVolume = volumeMultiplier * volumeLvl;
			this.v_state = Math.round(newVolume);
			this.log.debug('setVolumeState - actual mode, PERCENT, volume v_state: %s', this.v_state);
		} else if (volumeLvl > this.maxVolume) {
		// Determin if maxVolume threshold breached, if so set to max.
			this.v_state = this.maxVolume;
			this.log.debug('setVolumeState - VOLUME LEVEL of: %s exceeds maxVolume: %s. Resetting to max.', volumeLvl, this.maxVolume);
		} else {
		// Must be using actual volume number
			this.v_state = volumeLvl;
			this.log.debug('setVolumeState - actual mode, ACTUAL volume v_state: %s', this.v_state);
		}

		// do the callback immediately, to free homekit
		// have the event later on execute changes
		callback(null, this.v_state);

		this.vendor.setVolumeState ( this.v_state, error =>{
			if (error) {
				this.v_state = 0;
				this.log.debug('setVolumeState - VOLUME : ERROR - current v_state: %s', this.v_state);
			}
		});

		// Communicate status
		if (this.tvService)
			this.tvSpeakerService.getCharacteristic(Characteristic.Volume).updateValue(this.v_state);
	}

	setVolumeRelative(volumeDirection, callback, context) {
	// if context is v_statuspoll, then we need to ensure this we do not set the actual value
		if (context && context === 'v_statuspoll') {
			this.log.debug('setVolumeRelative - polling mode, ignore, v_state: %s', this.v_state);
			callback(null, this.v_state);
			return;
		}

		if (!this.ip_address) {
			this.log.error('Ignoring request; No ip_address defined.');
			callback(new Error('No ip_address defined.'));
			return;
		}

		this.setAttempt++;

		// do the callback immediately, to free homekit
		// have the event later on execute changes
		callback(null, this.v_state);
		if (volumeDirection === Characteristic.VolumeSelector.INCREMENT) {
			this.log.debug('setVolumeRelative - VOLUME : level-up');
			this.vendor.setVolumeRelative(true, error => {
				if (error) {
					this.v_state = 0;
					this.log.error('setVolumeRelative - VOLUME : ERROR - current v_state: %s', this.v_state);
				}
			});
		} else if (volumeDirection === Characteristic.VolumeSelector.DECREMENT) {
			this.log.debug('setVolumeRelative - VOLUME : level-down');
			this.vendor.setVolumeRelative(false, error => {
				if (error) {
					this.v_state = 0;
					this.log.error('setVolumeRelative - VOLUME : ERROR - current v_state: %s', this.v_state);
				}
			});
		} else {
			this.log.error('setVolumeRelative - VOLUME : ERROR - unknown direction sent');
		}

		// Communicate status
		if (this.tvService)
			this.tvSpeakerService.getCharacteristic(Characteristic.Volume).updateValue(this.v_state);
	}

	getMuteState(callback, context) {
		// if context is m_statuspoll, then we need to request the actual value
		if ((!context || context !== 'm_statuspoll') && this.switchHandling === 'poll') {
				this.log.debug('getMuteState - polling mode, return m_state: ', this.m_state);
				callback(null, this.m_state);
				return;
		}

		if (!this.ip_address) {
			this.log.error('Ignoring request; No ip_address defined.');
			callback(new Error('No ip_address defined.'));
			return;
		}

		// do the callback immediately, to free homekit
		// have the event later on execute changes
		callback(null, this.m_state);
		this.log.debug('getMuteState - actual mode, return m_state: ', this.m_state);
		this.vendor.getMuteState(error=>{
			if (error) {
				this.m_state = false;
				this.log.debug('getMuteState - MUTE QRY: ERROR - current m_state: %s', this.m_state);
			}
		});

		// Communicate status
		if (this.tvService)
			this.tvSpeakerService.getCharacteristic(Characteristic.Mute).updateValue(this.m_state);
	}

	setMuteState(muteOn, callback, context) {
	// if context is m_statuspoll, then we need to ensure this we do not set the actual value
		if (context && context === 'm_statuspoll') {
			this.log.debug('setMuteState - polling mode, ignore, m_state: %s', this.m_state);
			callback(null, this.m_state);
			return;
		}

		if (!this.ip_address) {
			this.log.error('Ignoring request; No ip_address defined.');
			callback(new Error('No ip_address defined.'));
			return;
		}

		this.setAttempt++;

		// do the callback immediately, to free homekit
		// have the event later on execute changes
		this.m_state = muteOn;
		callback(null, this.m_state);
		if (this.m_state) {
			this.log.debug('setMuteState - actual mode, mute m_state: %s, switching to ON', this.m_state);
			this.vendor.setMuteState(true, error=> {
				if (error) {
					this.m_state = false;
					this.log.error('setMuteState - MUTE ON: ERROR - current m_state: %s', this.m_state);
				}
			});
		} else {
			this.log.debug('setMuteState - actual mode, mute m_state: %s, switching to OFF', this.m_state);
			this.vendor.setMuteState(false, error=> {
				if (error) {
					this.m_state = false;
					this.log.error('setMuteState - MUTE OFF: ERROR - current m_state: %s', this.m_state);
				}
			});
		}

		// Communicate status
		if (this.tvService)
			this.tvSpeakerService.getCharacteristic(Characteristic.Mute).updateValue(this.m_state);
	}

	getInputSource(callback, context) {
		// if context is i_statuspoll, then we need to request the actual value
		if ((!context || context !== 'i_statuspoll') && this.switchHandling === 'poll') {
				this.log.debug('getInputState - polling mode, return i_state: ', this.i_state);
				callback(null, this.i_state);
				return;
		}

		if (!this.ip_address) {
			this.log.error('Ignoring request; No ip_address defined.');
			callback(new Error('No ip_address defined.'));
			return;
		}

		// do the callback immediately, to free homekit
		// have the event later on execute changes

		this.log.debug('getInputState - actual mode, return i_state: ', this.i_state);
		this.vendor.getInputSource(error =>{
			if (error) {
				this.i_state = 1;
				this.log.error('getInputState - INPUT QRY: ERROR - current i_state: %s', this.i_state);
			}
		});
		callback(null, this.i_state);
		// Communicate status
//FIXME		if (this.tvService)
//FIXME			this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).updateValue(this.i_state);
	}

	setInputSource(source, callback, context) {
	// if context is i_statuspoll, then we need to ensure this we do not set the actual value
		if (context && context === 'i_statuspoll') {
			this.log.info('setInputState - polling mode, ignore, i_state: %s', this.i_state);
			callback(null, this.i_state);
			return;
		}

		if (!this.ip_address) {
			this.log.error('Ignoring request; No ip_address defined.');
			callback(new Error('No ip_address defined.'));
			return;
		}

		this.setAttempt++;

		this.i_state = source;
		const label = this.RxInputs.Inputs[this.i_state - 1].label;

		this.log.debug('setInputState - actual mode, ACTUAL input i_state: %s - label: %s', this.i_state, label);

		// do the callback immediately, to free homekit
		// have the event later on execute changes
//FIXME		callback(null, this.i_state);
		callback();
		this.vendor.setInputSource(label, error => {
			if (error)
				this.log.error('setInputState - INPUT : ERROR - current i_state:%s - Source:%s', this.i_state, source.toString());
		});

		// Communicate status
		if (this.tvService)
			this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).updateValue(this.i_state);
	}

	remoteKeyPress(button, callback) {
		// do the callback immediately, to free homekit
		// have the event later on execute changes
		callback(null, button);
		if (this.buttons[button]) {
			const press = this.buttons[button];
			this.log.debug('remoteKeyPress - INPUT: pressing key %s', press);
			this.vendor.remoteKeyPress( press, error => {
				if (error) {
					// this.i_state = 1;
					this.log.error('remoteKeyPress - INPUT: ERROR pressing button %s', press);
				}
			});
		} else {
			this.log.error('Remote button %d not supported.', button);
		}
	}

	identify(callback) {
		this.log.info('Identify requested! %s', this.ip_address);
		callback(); // success
	}



}

// add protocol and comdev
class OnkyoAvrAccessory {

	constructor (obj ) {
		this.zone = obj.zone;
		this.log = obj.log;
		this.cmdMap = new Array(2);
		this.cmdMap.main = new Array(4);
		this.cmdMap.main.power = 'system-power';
		this.cmdMap.main.volume = 'master-volume';
		this.cmdMap.main.muting = 'audio-muting';
		this.cmdMap.main.input = 'input-selector';
		this.cmdMap.zone2 = new Array(4);
		this.cmdMap.zone2.power = 'power';
		this.cmdMap.zone2.volume = 'volume';
		this.cmdMap.zone2.muting = 'muting';
		this.cmdMap.zone2.input = 'selector';
		obj.maxVolume = obj.config.max_volume || 60;
		obj.avrManufacturer = 'Onkyo';
		obj.zone = (obj.config.zone || 'main').toLowerCase();

		obj.buttons = {
			[Characteristic.RemoteKey.REWIND]: 'rew',
			[Characteristic.RemoteKey.FAST_FORWARD]: 'ff',
			[Characteristic.RemoteKey.NEXT_TRACK]: 'skip-f',
			[Characteristic.RemoteKey.PREVIOUS_TRACK]: 'skip-r',
			[Characteristic.RemoteKey.ARROW_UP]: 'up', // 4
			[Characteristic.RemoteKey.ARROW_DOWN]: 'down', // 5
			[Characteristic.RemoteKey.ARROW_LEFT]: 'left', // 6
			[Characteristic.RemoteKey.ARROW_RIGHT]: 'right', // 7
			[Characteristic.RemoteKey.SELECT]: 'enter', // 8
			[Characteristic.RemoteKey.BACK]: 'exit', // 9
			[Characteristic.RemoteKey.EXIT]: 'exit', // 10
			[Characteristic.RemoteKey.PLAY_PAUSE]: 'play', // 11
			[Characteristic.RemoteKey.INFORMATION]: 'home' // 15
		};

	}

	connectAvr( obj ) {
		this.eiscp = importFresh('eiscp');
		this.log.debug("Connecting to " + obj.name + " with IP: " + obj.ip_address);
		this.eiscp.connect ( { host: obj.ip_address, reconnect: true, model: obj.model} );

		// bind callback
		this.eiscp.on('debug', obj.eventDebug.bind(obj));
		this.eiscp.on('error', obj.eventError.bind(obj));
		this.eiscp.on('connect', obj.eventConnect.bind(obj));
		this.eiscp.on('close', obj.eventClose.bind(obj));
		this.eiscp.on(this.cmdMap[this.zone].power, response => obj.eventSystemPower(this.isSystemPowerOn(response)));
		this.eiscp.on(this.cmdMap[this.zone].volume, obj.eventVolume.bind(obj));
		this.eiscp.on(this.cmdMap[this.zone].muting, obj.eventAudioMuting.bind(obj));
		this.eiscp.on(this.cmdMap[this.zone].input, response => obj.eventInput(this.eventInputLabel(response)));
	}

	createRxInput (obj ) {
		obj.log.debug("Creating RX input");
	// Create the RxInput object for later use.
		const eiscpDataAll = require('eiscp/eiscp-commands.json');
		const inSets = [];
		let set;

		for (set in eiscpDataAll.modelsets) {
			eiscpDataAll.modelsets[set].forEach(model => {
				if (model.includes(obj.model))
					inSets.push(set);
			});
		}
		if ( inSets.length < 1 ) {
			obj.log.error('Can not find model ' + obj.model +' in the database');
			return false
		}

		// Get list of commands from eiscpData
		const eiscpData = eiscpDataAll.commands.main.SLI.values;
		// Create a JSON object for inputs from the eiscpData
		let newobj = '{ "Inputs" : [';
		let exkey;
		for (exkey in eiscpData) {
			let hold = eiscpData[exkey].name.toString();
			if (hold.includes(','))
				hold = hold.slice(0, hold.indexOf(','));
			if (exkey.includes('“') || exkey.includes('”')) {
				exkey = exkey.replace(/“/g, '');
				exkey = exkey.replace(/”/g, '');
			}

			if (exkey.includes('UP') || exkey.includes('DOWN') || exkey.includes('QSTN'))
				continue;

			// Work around specific bug for “26”
			if (exkey === '“26”')
				exkey = '26';

			if (exkey in eiscpData) {
				if ('models' in eiscpData[exkey])
					set = eiscpData[exkey].models;
				else
					continue;
			} else {
				continue;
			}

			if (inSets.includes(set))
				newobj = newobj + '{ "code":"' + exkey + '" , "label":"' + hold + '" },';
			else
				continue;
		}

		// Drop last comma first
		newobj = newobj.slice(0, -1) + ']}';
		obj.log.debug(newobj);
		obj.RxInputs = JSON.parse(newobj);
		return true
	}

	isSystemPowerOn(msg) {
		return msg === 'on'
	}

	eventInputLabel (msg ) {
		let label = JSON.stringify(msg);
		label = label.replace(/[[\]"]+/g, '');
		if (label.includes(','))
			label = label.slice(0, label.indexOf(','));
		this.log.debug('eventInput - message: %s - input: %s', msg, label);
		return label;
	}

	setPowerStateOn(callback) {
		this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].power + '=on', callback)
	}

	setPowerStateOff(callback) {
		this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].power + '=standby', callback)
	}

	getPowerState(callback) {
		this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].power + '=query', callback)
	}

	getVolumeState(callback ) {
		this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].volume + '=query', callback )
	}

	setVolumeState(volumeLvl, callback) {
		this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].volume + ':' + volumeLvl, callback )
	}

	setVolumeRelative(volUp, callback) {
		this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].volume + ':level-' + (volUp ? 'up' : 'down' ), callback)
	}

	getMuteState(callback) {
		this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].muting + '=query', callback)
	}

	setMuteState(mute, callback) {
		this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].muting + '=' + (mute ? 'on' :'off'), callback)
	}

	getInputSource(callback) {
		this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].input + '=query', callback)
	}

	setInputSource(label, callback ) {
		this.eiscp.command(this.zone + '.' + this.cmdMap[this.zone].input + ':' + label, callback)
	}
	remoteKeyPress(press, callback ) {
		this.eiscp.command(this.zone + '.setup=' + press, callback)
	}
}

const vendors = { "Onkyo" : OnkyoAvrAccessory }

module.exports = homebridge => {
	({Service, Characteristic} = homebridge.hap);
	homebridge.registerPlatform('homebridge-generic-avr', 'GenericAvr', GenericAvrPlatform);
};
