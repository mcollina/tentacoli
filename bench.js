'use strict'

var bench = require('fastbench')
var pump = require('pump')
var net = require('net')
var tentacoli = require('./')

function buildPingPong (cb) {
  var sender = tentacoli()
  var server = net.createServer(handle)

  server.listen(0, function (err) {
    if (err) throw err

    var addr = server.address()
    var client = net.connect(addr.port, addr.host)

    pump(client, sender, client)

    cb(null, benchPingPong)
  })

  function handle (sock) {
    var receiver = tentacoli()
    pump(sock, receiver, sock)
    receiver.on('request', function request (req, reply) {
      reply(null, {
        cmd: 'pong'
      })
    })
  }

  function benchPingPong (cb) {
    sender.request({
      cmd: 'ping'
    }, cb)
  }
}

buildPingPong(function (err, benchPingPong) {
  if (err) throw err

  var run = bench([benchPingPong], 10000)

  run(function (err) {
    if (err) throw err

    run(function (err) {
      if (err) throw err

      // close the sockets the bad way
      process.exit(0)
    })
  })
})
