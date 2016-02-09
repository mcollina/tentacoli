'use strict'

var tentacoli = require('../')
var ws = require('websocket-stream')
var pump = require('pump')
var from = require('from2')

var URL = require('url')
var serverOpts = URL.parse(document.URL)
serverOpts.path = undefined
serverOpts.pathname = undefined
serverOpts.protocol = 'ws'
var server = URL.format(serverOpts)

var stream = ws(server)
var instance = tentacoli()

pump(stream, instance, stream)

instance.request({
  streams$: {
    inStream: from.obj(['hello', 'world'])
  }
}, function (err, data) {
  if (err) throw err

  var res = data.streams$.inStream
  res.on('data', function (chunk) {
    console.log(chunk)
  })
})
