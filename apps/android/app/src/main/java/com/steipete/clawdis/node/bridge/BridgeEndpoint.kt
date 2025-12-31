package com.steipete.clawdis.node.bridge

data class BridgeEndpoint(
  val stableId: String,
  val name: String,
  val host: String,
  val port: Int,
  val lanHost: String? = null,
  val tailnetDns: String? = null,
  val gatewayPort: Int? = null,
  val bridgePort: Int? = null,
  val canvasPort: Int? = null,
) {
  companion object {
    fun manual(host: String, port: Int): BridgeEndpoint =
      BridgeEndpoint(
        stableId = "manual|$host|$port",
        name = "$host:$port",
        host = host,
        port = port,
      )
  }
}
