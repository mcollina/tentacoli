'use strict'

var net = require('net')
var tentacoli = require('../')
var pump = require('pump')
var server = net.createServer(handle)

function handle (sock) {
  var receiver = tentacoli()
  pump(sock, receiver, sock)
  receiver.on('request', function request (req, reply) {
    reply(null, req)
  })
}

var port = process.send || 3000

server.listen(port, function (err) {
  if (err) throw err

  if (process.send) {
    process.send(server.address())
  } else {
    console.log('listening on', server.address().port)
  }
})

process.on('disconnect', function () {
  process.exit(0)
})
