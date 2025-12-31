package com.steipete.clawdis.node

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.steipete.clawdis.node.chat.ChatController
import com.steipete.clawdis.node.chat.ChatMessage
import com.steipete.clawdis.node.chat.ChatPendingToolCall
import com.steipete.clawdis.node.chat.ChatSessionEntry
import com.steipete.clawdis.node.chat.OutgoingAttachment
import com.steipete.clawdis.node.bridge.BridgeDiscovery
import com.steipete.clawdis.node.bridge.BridgeEndpoint
import com.steipete.clawdis.node.bridge.BridgePairingClient
import com.steipete.clawdis.node.bridge.BridgeSession
import com.steipete.clawdis.node.node.CameraCaptureManager
import com.steipete.clawdis.node.BuildConfig
import com.steipete.clawdis.node.node.CanvasController
import com.steipete.clawdis.node.node.ScreenRecordManager
import com.steipete.clawdis.node.protocol.ClawdisCapability
import com.steipete.clawdis.node.protocol.ClawdisCameraCommand
import com.steipete.clawdis.node.protocol.ClawdisCanvasA2UIAction
import com.steipete.clawdis.node.protocol.ClawdisCanvasA2UICommand
import com.steipete.clawdis.node.protocol.ClawdisCanvasCommand
import com.steipete.clawdis.node.protocol.ClawdisScreenCommand
import com.steipete.clawdis.node.voice.TalkModeManager
import com.steipete.clawdis.node.voice.VoiceWakeManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.util.concurrent.atomic.AtomicLong

class NodeRuntime(context: Context) {
  private val appContext = context.applicationContext
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  val prefs = SecurePrefs(appContext)
  val canvas = CanvasController()
  val camera = CameraCaptureManager(appContext)
  val screenRecorder = ScreenRecordManager(appContext)
  private val json = Json { ignoreUnknownKeys = true }

  private val externalAudioCaptureActive = MutableStateFlow(false)

  private val voiceWake: VoiceWakeManager by lazy {
    VoiceWakeManager(
      context = appContext,
      scope = scope,
      onCommand = { command ->
        session.sendEvent(
          event = "agent.request",
          payloadJson =
            buildJsonObject {
              put("message", JsonPrimitive(command))
              put("sessionKey", JsonPrimitive(mainSessionKey.value))
              put("thinking", JsonPrimitive(chatThinkingLevel.value))
              put("deliver", JsonPrimitive(false))
            }.toString(),
        )
      },
    )
  }

  val voiceWakeIsListening: StateFlow<Boolean>
    get() = voiceWake.isListening

  val voiceWakeStatusText: StateFlow<String>
    get() = voiceWake.statusText

  val talkStatusText: StateFlow<String>
    get() = talkMode.statusText

  val talkIsListening: StateFlow<Boolean>
    get() = talkMode.isListening

  val talkIsSpeaking: StateFlow<Boolean>
    get() = talkMode.isSpeaking

  private val discovery = BridgeDiscovery(appContext, scope = scope)
  val bridges: StateFlow<List<BridgeEndpoint>> = discovery.bridges
  val discoveryStatusText: StateFlow<String> = discovery.statusText

  private val _isConnected = MutableStateFlow(false)
  val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

  private val _statusText = MutableStateFlow("Offline")
  val statusText: StateFlow<String> = _statusText.asStateFlow()

  private val _mainSessionKey = MutableStateFlow("main")
  val mainSessionKey: StateFlow<String> = _mainSessionKey.asStateFlow()

  private val cameraHudSeq = AtomicLong(0)
  private val _cameraHud = MutableStateFlow<CameraHudState?>(null)
  val cameraHud: StateFlow<CameraHudState?> = _cameraHud.asStateFlow()

  private val _cameraFlashToken = MutableStateFlow(0L)
  val cameraFlashToken: StateFlow<Long> = _cameraFlashToken.asStateFlow()

  private val _screenRecordActive = MutableStateFlow(false)
  val screenRecordActive: StateFlow<Boolean> = _screenRecordActive.asStateFlow()

  private val _serverName = MutableStateFlow<String?>(null)
  val serverName: StateFlow<String?> = _serverName.asStateFlow()

  private val _remoteAddress = MutableStateFlow<String?>(null)
  val remoteAddress: StateFlow<String?> = _remoteAddress.asStateFlow()

  private val _seamColorArgb = MutableStateFlow(DEFAULT_SEAM_COLOR_ARGB)
  val seamColorArgb: StateFlow<Long> = _seamColorArgb.asStateFlow()

  private val _isForeground = MutableStateFlow(true)
  val isForeground: StateFlow<Boolean> = _isForeground.asStateFlow()

  private var lastAutoA2uiUrl: String? = null

  private val session =
    BridgeSession(
      scope = scope,
      onConnected = { name, remote ->
        _statusText.value = "Connected"
        _serverName.value = name
        _remoteAddress.value = remote
        _isConnected.value = true
        _seamColorArgb.value = DEFAULT_SEAM_COLOR_ARGB
        scope.launch { refreshBrandingFromGateway() }
        scope.launch { refreshWakeWordsFromGateway() }
        maybeNavigateToA2uiOnConnect()
      },
      onDisconnected = { message -> handleSessionDisconnected(message) },
      onEvent = { event, payloadJson ->
        handleBridgeEvent(event, payloadJson)
      },
      onInvoke = { req ->
        handleInvoke(req.command, req.paramsJson)
      },
    )

  private val chat = ChatController(scope = scope, session = session, json = json)
  private val talkMode: TalkModeManager by lazy {
    TalkModeManager(context = appContext, scope = scope).also { it.attachSession(session) }
  }

  private fun handleSessionDisconnected(message: String) {
    _statusText.value = message
    _serverName.value = null
    _remoteAddress.value = null
    _isConnected.value = false
    _seamColorArgb.value = DEFAULT_SEAM_COLOR_ARGB
    _mainSessionKey.value = "main"
    chat.onDisconnected(message)
    showLocalCanvasOnDisconnect()
  }

  private fun maybeNavigateToA2uiOnConnect() {
    val a2uiUrl = resolveA2uiHostUrl() ?: return
    val current = canvas.currentUrl()?.trim().orEmpty()
    if (current.isEmpty() || current == lastAutoA2uiUrl) {
      lastAutoA2uiUrl = a2uiUrl
      canvas.navigate(a2uiUrl)
    }
  }

  private fun showLocalCanvasOnDisconnect() {
    lastAutoA2uiUrl = null
    canvas.navigate("")
  }

  val instanceId: StateFlow<String> = prefs.instanceId
  val displayName: StateFlow<String> = prefs.displayName
  val cameraEnabled: StateFlow<Boolean> = prefs.cameraEnabled
  val preventSleep: StateFlow<Boolean> = prefs.preventSleep
  val wakeWords: StateFlow<List<String>> = prefs.wakeWords
  val voiceWakeMode: StateFlow<VoiceWakeMode> = prefs.voiceWakeMode
  val talkEnabled: StateFlow<Boolean> = prefs.talkEnabled
  val manualEnabled: StateFlow<Boolean> = prefs.manualEnabled
  val manualHost: StateFlow<String> = prefs.manualHost
  val manualPort: StateFlow<Int> = prefs.manualPort
  val lastDiscoveredStableId: StateFlow<String> = prefs.lastDiscoveredStableId
  val canvasDebugStatusEnabled: StateFlow<Boolean> = prefs.canvasDebugStatusEnabled

  private var didAutoConnect = false
  private var suppressWakeWordsSync = false
  private var wakeWordsSyncJob: Job? = null

  val chatSessionKey: StateFlow<String> = chat.sessionKey
  val chatSessionId: StateFlow<String?> = chat.sessionId
  val chatMessages: StateFlow<List<ChatMessage>> = chat.messages
  val chatError: StateFlow<String?> = chat.errorText
  val chatHealthOk: StateFlow<Boolean> = chat.healthOk
  val chatThinkingLevel: StateFlow<String> = chat.thinkingLevel
  val chatStreamingAssistantText: StateFlow<String?> = chat.streamingAssistantText
  val chatPendingToolCalls: StateFlow<List<ChatPendingToolCall>> = chat.pendingToolCalls
  val chatSessions: StateFlow<List<ChatSessionEntry>> = chat.sessions
  val pendingRunCount: StateFlow<Int> = chat.pendingRunCount

  init {
    scope.launch {
      combine(
        voiceWakeMode,
        isForeground,
        externalAudioCaptureActive,
        wakeWords,
      ) { mode, foreground, externalAudio, words ->
        Quad(mode, foreground, externalAudio, words)
      }.distinctUntilChanged()
        .collect { (mode, foreground, externalAudio, words) ->
          voiceWake.setTriggerWords(words)

          val shouldListen =
            when (mode) {
              VoiceWakeMode.Off -> false
              VoiceWakeMode.Foreground -> foreground
              VoiceWakeMode.Always -> true
            } && !externalAudio

          if (!shouldListen) {
            voiceWake.stop(statusText = if (mode == VoiceWakeMode.Off) "Off" else "Paused")
            return@collect
          }

          if (!hasRecordAudioPermission()) {
            voiceWake.stop(statusText = "Microphone permission required")
            return@collect
          }

          voiceWake.start()
        }
    }

    scope.launch {
      talkEnabled.collect { enabled ->
        talkMode.setEnabled(enabled)
        externalAudioCaptureActive.value = enabled
      }
    }

    scope.launch(Dispatchers.Default) {
      bridges.collect { list ->
        if (list.isNotEmpty()) {
          // Persist the last discovered bridge (best-effort UX parity with iOS).
          prefs.setLastDiscoveredStableId(list.last().stableId)
        }

        if (didAutoConnect) return@collect
        if (_isConnected.value) return@collect

        val token = prefs.loadBridgeToken()
        if (token.isNullOrBlank()) return@collect

        if (manualEnabled.value) {
          val host = manualHost.value.trim()
          val port = manualPort.value
          if (host.isNotEmpty() && port in 1..65535) {
            didAutoConnect = true
            connect(BridgeEndpoint.manual(host = host, port = port))
          }
          return@collect
        }

        val targetStableId = lastDiscoveredStableId.value.trim()
        if (targetStableId.isEmpty()) return@collect
        val target = list.firstOrNull { it.stableId == targetStableId } ?: return@collect
        didAutoConnect = true
        connect(target)
      }
    }

    scope.launch {
      combine(
        canvasDebugStatusEnabled,
        statusText,
        serverName,
        remoteAddress,
      ) { debugEnabled, status, server, remote ->
        Quad(debugEnabled, status, server, remote)
      }.distinctUntilChanged()
        .collect { (debugEnabled, status, server, remote) ->
          canvas.setDebugStatusEnabled(debugEnabled)
          if (!debugEnabled) return@collect
          canvas.setDebugStatus(status, server ?: remote)
        }
    }
  }

  fun setForeground(value: Boolean) {
    _isForeground.value = value
  }

  fun setDisplayName(value: String) {
    prefs.setDisplayName(value)
  }

  fun setCameraEnabled(value: Boolean) {
    prefs.setCameraEnabled(value)
  }

  fun setPreventSleep(value: Boolean) {
    prefs.setPreventSleep(value)
  }

  fun setManualEnabled(value: Boolean) {
    prefs.setManualEnabled(value)
  }

  fun setManualHost(value: String) {
    prefs.setManualHost(value)
  }

  fun setManualPort(value: Int) {
    prefs.setManualPort(value)
  }

  fun setCanvasDebugStatusEnabled(value: Boolean) {
    prefs.setCanvasDebugStatusEnabled(value)
  }

  fun setWakeWords(words: List<String>) {
    prefs.setWakeWords(words)
    scheduleWakeWordsSyncIfNeeded()
  }

  fun resetWakeWordsDefaults() {
    setWakeWords(SecurePrefs.defaultWakeWords)
  }

  fun setVoiceWakeMode(mode: VoiceWakeMode) {
    prefs.setVoiceWakeMode(mode)
  }

  fun setTalkEnabled(value: Boolean) {
    prefs.setTalkEnabled(value)
  }

  fun connect(endpoint: BridgeEndpoint) {
    scope.launch {
      _statusText.value = "Connecting…"
      val storedToken = prefs.loadBridgeToken()
      val modelIdentifier = listOfNotNull(Build.MANUFACTURER, Build.MODEL)
        .joinToString(" ")
        .trim()
        .ifEmpty { null }

      val invokeCommands =
        buildList {
          add(ClawdisCanvasCommand.Present.rawValue)
          add(ClawdisCanvasCommand.Hide.rawValue)
          add(ClawdisCanvasCommand.Navigate.rawValue)
          add(ClawdisCanvasCommand.Eval.rawValue)
          add(ClawdisCanvasCommand.Snapshot.rawValue)
          add(ClawdisCanvasA2UICommand.Push.rawValue)
          add(ClawdisCanvasA2UICommand.PushJSONL.rawValue)
          add(ClawdisCanvasA2UICommand.Reset.rawValue)
          add(ClawdisScreenCommand.Record.rawValue)
          if (cameraEnabled.value) {
            add(ClawdisCameraCommand.Snap.rawValue)
            add(ClawdisCameraCommand.Clip.rawValue)
          }
        }
      val resolved =
        if (storedToken.isNullOrBlank()) {
          _statusText.value = "Pairing…"
          val caps = buildList {
            add(ClawdisCapability.Canvas.rawValue)
            add(ClawdisCapability.Screen.rawValue)
            if (cameraEnabled.value) add(ClawdisCapability.Camera.rawValue)
            if (voiceWakeMode.value != VoiceWakeMode.Off && hasRecordAudioPermission()) {
              add(ClawdisCapability.VoiceWake.rawValue)
            }
          }
          val versionName = BuildConfig.VERSION_NAME.trim().ifEmpty { "dev" }
          val advertisedVersion =
            if (BuildConfig.DEBUG && !versionName.contains("dev", ignoreCase = true)) {
              "$versionName-dev"
            } else {
              versionName
            }
          BridgePairingClient().pairAndHello(
            endpoint = endpoint,
            hello =
              BridgePairingClient.Hello(
                nodeId = instanceId.value,
                displayName = displayName.value,
                token = null,
                platform = "Android",
                version = advertisedVersion,
                deviceFamily = "Android",
                modelIdentifier = modelIdentifier,
                caps = caps,
                commands = invokeCommands,
              ),
          )
        } else {
          BridgePairingClient.PairResult(ok = true, token = storedToken.trim())
        }

      if (!resolved.ok || resolved.token.isNullOrBlank()) {
        _statusText.value = "Failed: pairing required"
        return@launch
      }

      val authToken = requireNotNull(resolved.token).trim()
      prefs.saveBridgeToken(authToken)
      val versionName = BuildConfig.VERSION_NAME.trim().ifEmpty { "dev" }
      val advertisedVersion =
        if (BuildConfig.DEBUG && !versionName.contains("dev", ignoreCase = true)) {
          "$versionName-dev"
        } else {
          versionName
        }
      session.connect(
        endpoint = endpoint,
        hello =
          BridgeSession.Hello(
            nodeId = instanceId.value,
            displayName = displayName.value,
            token = authToken,
            platform = "Android",
            version = advertisedVersion,
            deviceFamily = "Android",
            modelIdentifier = modelIdentifier,
            caps =
              buildList {
                add(ClawdisCapability.Canvas.rawValue)
                add(ClawdisCapability.Screen.rawValue)
                if (cameraEnabled.value) add(ClawdisCapability.Camera.rawValue)
                if (voiceWakeMode.value != VoiceWakeMode.Off && hasRecordAudioPermission()) {
                  add(ClawdisCapability.VoiceWake.rawValue)
                }
              },
            commands = invokeCommands,
          ),
      )
    }
  }

  private fun hasRecordAudioPermission(): Boolean {
    return (
      ContextCompat.checkSelfPermission(appContext, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED
      )
  }

  fun connectManual() {
    val host = manualHost.value.trim()
    val port = manualPort.value
    if (host.isEmpty() || port <= 0 || port > 65535) {
      _statusText.value = "Failed: invalid manual host/port"
      return
    }
    connect(BridgeEndpoint.manual(host = host, port = port))
  }

  fun disconnect() {
    session.disconnect()
  }

  fun handleCanvasA2UIActionFromWebView(payloadJson: String) {
    scope.launch {
      val trimmed = payloadJson.trim()
      if (trimmed.isEmpty()) return@launch

      val root =
        try {
          json.parseToJsonElement(trimmed).asObjectOrNull() ?: return@launch
        } catch (_: Throwable) {
          return@launch
        }

      val userActionObj = (root["userAction"] as? JsonObject) ?: root
      val actionId = (userActionObj["id"] as? JsonPrimitive)?.content?.trim().orEmpty().ifEmpty {
        java.util.UUID.randomUUID().toString()
      }
      val name = ClawdisCanvasA2UIAction.extractActionName(userActionObj) ?: return@launch

      val surfaceId =
        (userActionObj["surfaceId"] as? JsonPrimitive)?.content?.trim().orEmpty().ifEmpty { "main" }
      val sourceComponentId =
        (userActionObj["sourceComponentId"] as? JsonPrimitive)?.content?.trim().orEmpty().ifEmpty { "-" }
      val contextJson = (userActionObj["context"] as? JsonObject)?.toString()

      val sessionKey = "main"
      val message =
        ClawdisCanvasA2UIAction.formatAgentMessage(
          actionName = name,
          sessionKey = sessionKey,
          surfaceId = surfaceId,
          sourceComponentId = sourceComponentId,
          host = displayName.value,
          instanceId = instanceId.value.lowercase(),
          contextJson = contextJson,
        )

      val connected = isConnected.value
      var error: String? = null
      if (connected) {
        try {
          session.sendEvent(
            event = "agent.request",
            payloadJson =
              buildJsonObject {
                put("message", JsonPrimitive(message))
                put("sessionKey", JsonPrimitive(sessionKey))
                put("thinking", JsonPrimitive("low"))
                put("deliver", JsonPrimitive(false))
                put("key", JsonPrimitive(actionId))
              }.toString(),
          )
        } catch (e: Throwable) {
          error = e.message ?: "send failed"
        }
      } else {
        error = "bridge not connected"
      }

      try {
        canvas.eval(
          ClawdisCanvasA2UIAction.jsDispatchA2UIActionStatus(
            actionId = actionId,
            ok = connected && error == null,
            error = error,
          ),
        )
      } catch (_: Throwable) {
        // ignore
      }
    }
  }

  fun loadChat(sessionKey: String = "main") {
    chat.load(sessionKey)
  }

  fun refreshChat() {
    chat.refresh()
  }

  fun refreshChatSessions(limit: Int? = null) {
    chat.refreshSessions(limit = limit)
  }

  fun setChatThinkingLevel(level: String) {
    chat.setThinkingLevel(level)
  }

  fun switchChatSession(sessionKey: String) {
    chat.switchSession(sessionKey)
  }

  fun abortChat() {
    chat.abort()
  }

  fun sendChat(message: String, thinking: String, attachments: List<OutgoingAttachment>) {
    chat.sendMessage(message = message, thinkingLevel = thinking, attachments = attachments)
  }

  private fun handleBridgeEvent(event: String, payloadJson: String?) {
    if (event == "voicewake.changed") {
      if (payloadJson.isNullOrBlank()) return
      try {
        val payload = json.parseToJsonElement(payloadJson).asObjectOrNull() ?: return
        val array = payload["triggers"] as? JsonArray ?: return
        val triggers = array.mapNotNull { it.asStringOrNull() }
        applyWakeWordsFromGateway(triggers)
      } catch (_: Throwable) {
        // ignore
      }
      return
    }

    talkMode.handleBridgeEvent(event, payloadJson)
    chat.handleBridgeEvent(event, payloadJson)
  }

  private fun applyWakeWordsFromGateway(words: List<String>) {
    suppressWakeWordsSync = true
    prefs.setWakeWords(words)
    suppressWakeWordsSync = false
  }

  private fun scheduleWakeWordsSyncIfNeeded() {
    if (suppressWakeWordsSync) return
    if (!_isConnected.value) return

    val snapshot = prefs.wakeWords.value
    wakeWordsSyncJob?.cancel()
    wakeWordsSyncJob =
      scope.launch {
        delay(650)
        val jsonList = snapshot.joinToString(separator = ",") { it.toJsonString() }
        val params = """{"triggers":[$jsonList]}"""
        try {
          session.request("voicewake.set", params)
        } catch (_: Throwable) {
          // ignore
        }
      }
  }

  private suspend fun refreshWakeWordsFromGateway() {
    if (!_isConnected.value) return
    try {
      val res = session.request("voicewake.get", "{}")
      val payload = json.parseToJsonElement(res).asObjectOrNull() ?: return
      val array = payload["triggers"] as? JsonArray ?: return
      val triggers = array.mapNotNull { it.asStringOrNull() }
      applyWakeWordsFromGateway(triggers)
    } catch (_: Throwable) {
      // ignore
    }
  }

  private suspend fun refreshBrandingFromGateway() {
    if (!_isConnected.value) return
    try {
      val res = session.request("config.get", "{}")
      val root = json.parseToJsonElement(res).asObjectOrNull()
      val config = root?.get("config").asObjectOrNull()
      val ui = config?.get("ui").asObjectOrNull()
      val raw = ui?.get("seamColor").asStringOrNull()?.trim()
      val sessionCfg = config?.get("session").asObjectOrNull()
      val rawMainKey = sessionCfg?.get("mainKey").asStringOrNull()?.trim()
      _mainSessionKey.value = rawMainKey?.takeIf { it.isNotEmpty() } ?: "main"

      val parsed = parseHexColorArgb(raw)
      _seamColorArgb.value = parsed ?: DEFAULT_SEAM_COLOR_ARGB
    } catch (_: Throwable) {
      // ignore
    }
  }

  private suspend fun handleInvoke(command: String, paramsJson: String?): BridgeSession.InvokeResult {
    if (
      command.startsWith(ClawdisCanvasCommand.NamespacePrefix) ||
        command.startsWith(ClawdisCanvasA2UICommand.NamespacePrefix) ||
        command.startsWith(ClawdisCameraCommand.NamespacePrefix) ||
        command.startsWith(ClawdisScreenCommand.NamespacePrefix)
      ) {
      if (!isForeground.value) {
        return BridgeSession.InvokeResult.error(
          code = "NODE_BACKGROUND_UNAVAILABLE",
          message = "NODE_BACKGROUND_UNAVAILABLE: canvas/camera/screen commands require foreground",
        )
      }
    }
    if (command.startsWith(ClawdisCameraCommand.NamespacePrefix) && !cameraEnabled.value) {
      return BridgeSession.InvokeResult.error(
        code = "CAMERA_DISABLED",
        message = "CAMERA_DISABLED: enable Camera in Settings",
      )
    }

    return when (command) {
      ClawdisCanvasCommand.Present.rawValue -> {
        val url = CanvasController.parseNavigateUrl(paramsJson)
        canvas.navigate(url)
        BridgeSession.InvokeResult.ok(null)
      }
      ClawdisCanvasCommand.Hide.rawValue -> BridgeSession.InvokeResult.ok(null)
      ClawdisCanvasCommand.Navigate.rawValue -> {
        val url = CanvasController.parseNavigateUrl(paramsJson)
        canvas.navigate(url)
        BridgeSession.InvokeResult.ok(null)
      }
      ClawdisCanvasCommand.Eval.rawValue -> {
        val js =
          CanvasController.parseEvalJs(paramsJson)
            ?: return BridgeSession.InvokeResult.error(
              code = "INVALID_REQUEST",
              message = "INVALID_REQUEST: javaScript required",
            )
        val result =
          try {
            canvas.eval(js)
          } catch (err: Throwable) {
            return BridgeSession.InvokeResult.error(
              code = "NODE_BACKGROUND_UNAVAILABLE",
              message = "NODE_BACKGROUND_UNAVAILABLE: canvas unavailable",
            )
          }
        BridgeSession.InvokeResult.ok("""{"result":${result.toJsonString()}}""")
      }
      ClawdisCanvasCommand.Snapshot.rawValue -> {
        val snapshotParams = CanvasController.parseSnapshotParams(paramsJson)
        val base64 =
          try {
            canvas.snapshotBase64(
              format = snapshotParams.format,
              quality = snapshotParams.quality,
              maxWidth = snapshotParams.maxWidth,
            )
          } catch (err: Throwable) {
            return BridgeSession.InvokeResult.error(
              code = "NODE_BACKGROUND_UNAVAILABLE",
              message = "NODE_BACKGROUND_UNAVAILABLE: canvas unavailable",
            )
          }
        BridgeSession.InvokeResult.ok("""{"format":"${snapshotParams.format.rawValue}","base64":"$base64"}""")
      }
      ClawdisCanvasA2UICommand.Reset.rawValue -> {
        val a2uiUrl = resolveA2uiHostUrl()
          ?: return BridgeSession.InvokeResult.error(
            code = "A2UI_HOST_NOT_CONFIGURED",
            message = "A2UI_HOST_NOT_CONFIGURED: gateway did not advertise canvas host",
          )
        val ready = ensureA2uiReady(a2uiUrl)
        if (!ready) {
          return BridgeSession.InvokeResult.error(
            code = "A2UI_HOST_UNAVAILABLE",
            message = "A2UI host not reachable",
          )
        }
        val res = canvas.eval(a2uiResetJS)
        BridgeSession.InvokeResult.ok(res)
      }
      ClawdisCanvasA2UICommand.Push.rawValue, ClawdisCanvasA2UICommand.PushJSONL.rawValue -> {
        val messages =
          try {
            decodeA2uiMessages(command, paramsJson)
          } catch (err: Throwable) {
            return BridgeSession.InvokeResult.error(code = "INVALID_REQUEST", message = err.message ?: "invalid A2UI payload")
          }
        val a2uiUrl = resolveA2uiHostUrl()
          ?: return BridgeSession.InvokeResult.error(
            code = "A2UI_HOST_NOT_CONFIGURED",
            message = "A2UI_HOST_NOT_CONFIGURED: gateway did not advertise canvas host",
          )
        val ready = ensureA2uiReady(a2uiUrl)
        if (!ready) {
          return BridgeSession.InvokeResult.error(
            code = "A2UI_HOST_UNAVAILABLE",
            message = "A2UI host not reachable",
          )
        }
        val js = a2uiApplyMessagesJS(messages)
        val res = canvas.eval(js)
        BridgeSession.InvokeResult.ok(res)
      }
      ClawdisCameraCommand.Snap.rawValue -> {
        showCameraHud(message = "Taking photo…", kind = CameraHudKind.Photo)
        triggerCameraFlash()
        val res =
          try {
            camera.snap(paramsJson)
          } catch (err: Throwable) {
            val (code, message) = invokeErrorFromThrowable(err)
            showCameraHud(message = message, kind = CameraHudKind.Error, autoHideMs = 2200)
            return BridgeSession.InvokeResult.error(code = code, message = message)
          }
        showCameraHud(message = "Photo captured", kind = CameraHudKind.Success, autoHideMs = 1600)
        BridgeSession.InvokeResult.ok(res.payloadJson)
      }
      ClawdisCameraCommand.Clip.rawValue -> {
        val includeAudio = paramsJson?.contains("\"includeAudio\":true") != false
        if (includeAudio) externalAudioCaptureActive.value = true
        try {
          showCameraHud(message = "Recording…", kind = CameraHudKind.Recording)
          val res =
            try {
              camera.clip(paramsJson)
            } catch (err: Throwable) {
              val (code, message) = invokeErrorFromThrowable(err)
              showCameraHud(message = message, kind = CameraHudKind.Error, autoHideMs = 2400)
              return BridgeSession.InvokeResult.error(code = code, message = message)
            }
          showCameraHud(message = "Clip captured", kind = CameraHudKind.Success, autoHideMs = 1800)
          BridgeSession.InvokeResult.ok(res.payloadJson)
        } finally {
          if (includeAudio) externalAudioCaptureActive.value = false
        }
      }
      ClawdisScreenCommand.Record.rawValue -> {
        // Status pill mirrors screen recording state so it stays visible without overlay stacking.
        _screenRecordActive.value = true
        try {
          val res =
            try {
              screenRecorder.record(paramsJson)
            } catch (err: Throwable) {
              val (code, message) = invokeErrorFromThrowable(err)
              return BridgeSession.InvokeResult.error(code = code, message = message)
            }
          BridgeSession.InvokeResult.ok(res.payloadJson)
        } finally {
          _screenRecordActive.value = false
        }
      }
      else ->
        BridgeSession.InvokeResult.error(
          code = "INVALID_REQUEST",
          message = "INVALID_REQUEST: unknown command",
        )
    }
  }

  private fun triggerCameraFlash() {
    // Token is used as a pulse trigger; value doesn't matter as long as it changes.
    _cameraFlashToken.value = SystemClock.elapsedRealtimeNanos()
  }

  private fun showCameraHud(message: String, kind: CameraHudKind, autoHideMs: Long? = null) {
    val token = cameraHudSeq.incrementAndGet()
    _cameraHud.value = CameraHudState(token = token, kind = kind, message = message)

    if (autoHideMs != null && autoHideMs > 0) {
      scope.launch {
        delay(autoHideMs)
        if (_cameraHud.value?.token == token) _cameraHud.value = null
      }
    }
  }

  private fun invokeErrorFromThrowable(err: Throwable): Pair<String, String> {
    val raw = (err.message ?: "").trim()
    if (raw.isEmpty()) return "UNAVAILABLE" to "UNAVAILABLE: camera error"

    val idx = raw.indexOf(':')
    if (idx <= 0) return "UNAVAILABLE" to raw
    val code = raw.substring(0, idx).trim().ifEmpty { "UNAVAILABLE" }
    val message = raw.substring(idx + 1).trim().ifEmpty { raw }
    // Preserve full string for callers/logging, but keep the returned message human-friendly.
    return code to "$code: $message"
  }

  private fun resolveA2uiHostUrl(): String? {
    val raw = session.currentCanvasHostUrl()?.trim().orEmpty()
    if (raw.isBlank()) return null
    val base = raw.trimEnd('/')
    return "${base}/__clawdis__/a2ui/?platform=android"
  }

  private suspend fun ensureA2uiReady(a2uiUrl: String): Boolean {
    try {
      val already = canvas.eval(a2uiReadyCheckJS)
      if (already == "true") return true
    } catch (_: Throwable) {
      // ignore
    }

    canvas.navigate(a2uiUrl)
    repeat(50) {
      try {
        val ready = canvas.eval(a2uiReadyCheckJS)
        if (ready == "true") return true
      } catch (_: Throwable) {
        // ignore
      }
      delay(120)
    }
    return false
  }

  private fun decodeA2uiMessages(command: String, paramsJson: String?): String {
    val raw = paramsJson?.trim().orEmpty()
    if (raw.isBlank()) throw IllegalArgumentException("INVALID_REQUEST: paramsJSON required")

    val obj =
      json.parseToJsonElement(raw) as? JsonObject
        ?: throw IllegalArgumentException("INVALID_REQUEST: expected object params")

    val jsonlField = (obj["jsonl"] as? JsonPrimitive)?.content?.trim().orEmpty()
    val hasMessagesArray = obj["messages"] is JsonArray

    if (command == ClawdisCanvasA2UICommand.PushJSONL.rawValue || (!hasMessagesArray && jsonlField.isNotBlank())) {
      val jsonl = jsonlField
      if (jsonl.isBlank()) throw IllegalArgumentException("INVALID_REQUEST: jsonl required")
      val messages =
        jsonl
          .lineSequence()
          .map { it.trim() }
          .filter { it.isNotBlank() }
          .mapIndexed { idx, line ->
            val el = json.parseToJsonElement(line)
            val msg =
              el as? JsonObject
                ?: throw IllegalArgumentException("A2UI JSONL line ${idx + 1}: expected a JSON object")
            validateA2uiV0_8(msg, idx + 1)
            msg
          }
          .toList()
      return JsonArray(messages).toString()
    }

    val arr = obj["messages"] as? JsonArray ?: throw IllegalArgumentException("INVALID_REQUEST: messages[] required")
    val out =
      arr.mapIndexed { idx, el ->
        val msg =
          el as? JsonObject
            ?: throw IllegalArgumentException("A2UI messages[${idx}]: expected a JSON object")
        validateA2uiV0_8(msg, idx + 1)
        msg
      }
    return JsonArray(out).toString()
  }

  private fun validateA2uiV0_8(msg: JsonObject, lineNumber: Int) {
    if (msg.containsKey("createSurface")) {
      throw IllegalArgumentException(
        "A2UI JSONL line $lineNumber: looks like A2UI v0.9 (`createSurface`). Canvas supports v0.8 messages only.",
      )
    }
    val allowed = setOf("beginRendering", "surfaceUpdate", "dataModelUpdate", "deleteSurface")
    val matched = msg.keys.filter { allowed.contains(it) }
    if (matched.size != 1) {
      val found = msg.keys.sorted().joinToString(", ")
      throw IllegalArgumentException(
        "A2UI JSONL line $lineNumber: expected exactly one of ${allowed.sorted().joinToString(", ")}; found: $found",
      )
    }
  }
}

private data class Quad<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)

private const val DEFAULT_SEAM_COLOR_ARGB: Long = 0xFF4F7A9A

private const val a2uiReadyCheckJS: String =
  """
  (() => {
    try {
      return !!globalThis.clawdisA2UI && typeof globalThis.clawdisA2UI.applyMessages === 'function';
    } catch (_) {
      return false;
    }
  })()
  """

private const val a2uiResetJS: String =
  """
  (() => {
    try {
      if (!globalThis.clawdisA2UI) return { ok: false, error: "missing clawdisA2UI" };
      return globalThis.clawdisA2UI.reset();
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  })()
  """

private fun a2uiApplyMessagesJS(messagesJson: String): String {
  return """
    (() => {
      try {
        if (!globalThis.clawdisA2UI) return { ok: false, error: "missing clawdisA2UI" };
        const messages = $messagesJson;
        return globalThis.clawdisA2UI.applyMessages(messages);
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) };
      }
    })()
  """.trimIndent()
}

private fun String.toJsonString(): String {
  val escaped =
    this.replace("\\", "\\\\")
      .replace("\"", "\\\"")
      .replace("\n", "\\n")
      .replace("\r", "\\r")
  return "\"$escaped\""
}

private fun JsonElement?.asObjectOrNull(): JsonObject? = this as? JsonObject

private fun JsonElement?.asStringOrNull(): String? =
  when (this) {
    is JsonNull -> null
    is JsonPrimitive -> content
    else -> null
  }

private fun parseHexColorArgb(raw: String?): Long? {
  val trimmed = raw?.trim().orEmpty()
  if (trimmed.isEmpty()) return null
  val hex = if (trimmed.startsWith("#")) trimmed.drop(1) else trimmed
  if (hex.length != 6) return null
  val rgb = hex.toLongOrNull(16) ?: return null
  return 0xFF000000L or rgb
}
