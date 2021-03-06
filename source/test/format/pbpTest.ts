﻿///<reference path="../global.d.ts" />
export function ref() { } // Workaround to allow typescript to include this module

import _pbp = require('../../src/format/pbp');

import Pbp = _pbp.Pbp;

describe('pbp', () => {
	var rtctestPbpArrayBuffer: ArrayBuffer;

	before(() => {
		return downloadFileAsync('data/samples/rtctest.pbp').then((data) => {
			rtctestPbpArrayBuffer = data;
		});
	});

	it('should load fine', () => {
		var pbp = new Pbp();
		pbp.load(Stream.fromArrayBuffer(rtctestPbpArrayBuffer));
		var pspData = pbp.get('psp.data');
		assert.equal(pspData.length, 77550);
	});
});
