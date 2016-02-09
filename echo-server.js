'use strict'

var minimist = require('minimist')
var http = require('http')
var tentacoli = require('./')
var pump = require('pump')
var fs = require('fs')
var p = require('path')
var websocket = require('websocket-stream')
var server = http.createServer(serve)

websocket.createServer({
  server: server
}, handle)

var argv = minimist(process.argv.slice(2), {
  default: {
    port: process.env.ZUUL_PORT || 3000,
    host: 'localhost'
  }
})

function handle (sock) {
  var receiver = tentacoli()
  pump(sock, receiver, sock)
  receiver.on('request', function request (req, reply) {
    reply(null, req)
  })
}

function serve (req, res) {
  if (req.url === '/') {
    req.url = '/echo.html'
  }
  var path = p.join(__dirname, 'examples', req.url.replace('/', ''))
  pump(
    fs.createReadStream(path),
    res
  )
}

server.listen(argv.port, function (err) {
  if (err) throw err
  console.error('listening on', server.address().port)
})
