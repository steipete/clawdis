package com.steipete.clawdis.node.bridge

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

class BridgeEndpointKotestTest : StringSpec({
  "manual endpoint builds stable id + name" {
    val endpoint = BridgeEndpoint.manual("10.0.0.5", 18790)
    endpoint.stableId shouldBe "manual|10.0.0.5|18790"
    endpoint.name shouldBe "10.0.0.5:18790"
    endpoint.host shouldBe "10.0.0.5"
    endpoint.port shouldBe 18790
  }
})
