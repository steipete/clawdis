@file:Suppress("DEPRECATION")

package com.steipete.clawdis.node

import android.content.Context
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import java.util.UUID

class SecurePrefs(context: Context) {
  companion object {
    val defaultWakeWords: List<String> = listOf("clawd", "claude")
    private const val displayNameKey = "node.displayName"
    private const val voiceWakeModeKey = "voiceWake.mode"
  }

  private val json = Json { ignoreUnknownKeys = true }

  private val masterKey =
    MasterKey.Builder(context)
      .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
      .build()

  private val prefs =
    EncryptedSharedPreferences.create(
      context,
      "clawdis.node.secure",
      masterKey,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

  private val _instanceId = MutableStateFlow(loadOrCreateInstanceId())
  val instanceId: StateFlow<String> = _instanceId

  private val _displayName =
    MutableStateFlow(loadOrMigrateDisplayName(context = context))
  val displayName: StateFlow<String> = _displayName

  private val _cameraEnabled = MutableStateFlow(prefs.getBoolean("camera.enabled", true))
  val cameraEnabled: StateFlow<Boolean> = _cameraEnabled

  private val _preventSleep = MutableStateFlow(prefs.getBoolean("screen.preventSleep", true))
  val preventSleep: StateFlow<Boolean> = _preventSleep

  private val _manualEnabled = MutableStateFlow(prefs.getBoolean("bridge.manual.enabled", false))
  val manualEnabled: StateFlow<Boolean> = _manualEnabled

  private val _manualHost = MutableStateFlow(prefs.getString("bridge.manual.host", "")!!)
  val manualHost: StateFlow<String> = _manualHost

  private val _manualPort = MutableStateFlow(prefs.getInt("bridge.manual.port", 18790))
  val manualPort: StateFlow<Int> = _manualPort

  private val _lastDiscoveredStableId =
    MutableStateFlow(prefs.getString("bridge.lastDiscoveredStableId", "")!!)
  val lastDiscoveredStableId: StateFlow<String> = _lastDiscoveredStableId

  private val _canvasDebugStatusEnabled =
    MutableStateFlow(prefs.getBoolean("canvas.debugStatusEnabled", false))
  val canvasDebugStatusEnabled: StateFlow<Boolean> = _canvasDebugStatusEnabled

  private val _wakeWords = MutableStateFlow(loadWakeWords())
  val wakeWords: StateFlow<List<String>> = _wakeWords

  private val _voiceWakeMode = MutableStateFlow(loadVoiceWakeMode())
  val voiceWakeMode: StateFlow<VoiceWakeMode> = _voiceWakeMode

  private val _talkEnabled = MutableStateFlow(prefs.getBoolean("talk.enabled", false))
  val talkEnabled: StateFlow<Boolean> = _talkEnabled

  fun setLastDiscoveredStableId(value: String) {
    val trimmed = value.trim()
    prefs.edit { putString("bridge.lastDiscoveredStableId", trimmed) }
    _lastDiscoveredStableId.value = trimmed
  }

  fun setDisplayName(value: String) {
    val trimmed = value.trim()
    prefs.edit { putString(displayNameKey, trimmed) }
    _displayName.value = trimmed
  }

  fun setCameraEnabled(value: Boolean) {
    prefs.edit { putBoolean("camera.enabled", value) }
    _cameraEnabled.value = value
  }

  fun setPreventSleep(value: Boolean) {
    prefs.edit { putBoolean("screen.preventSleep", value) }
    _preventSleep.value = value
  }

  fun setManualEnabled(value: Boolean) {
    prefs.edit { putBoolean("bridge.manual.enabled", value) }
    _manualEnabled.value = value
  }

  fun setManualHost(value: String) {
    val trimmed = value.trim()
    prefs.edit { putString("bridge.manual.host", trimmed) }
    _manualHost.value = trimmed
  }

  fun setManualPort(value: Int) {
    prefs.edit { putInt("bridge.manual.port", value) }
    _manualPort.value = value
  }

  fun setCanvasDebugStatusEnabled(value: Boolean) {
    prefs.edit { putBoolean("canvas.debugStatusEnabled", value) }
    _canvasDebugStatusEnabled.value = value
  }

  fun loadBridgeToken(): String? {
    val key = "bridge.token.${_instanceId.value}"
    return prefs.getString(key, null)
  }

  fun saveBridgeToken(token: String) {
    val key = "bridge.token.${_instanceId.value}"
    prefs.edit { putString(key, token.trim()) }
  }

  private fun loadOrCreateInstanceId(): String {
    val existing = prefs.getString("node.instanceId", null)?.trim()
    if (!existing.isNullOrBlank()) return existing
    val fresh = UUID.randomUUID().toString()
    prefs.edit { putString("node.instanceId", fresh) }
    return fresh
  }

  private fun loadOrMigrateDisplayName(context: Context): String {
    val existing = prefs.getString(displayNameKey, null)?.trim().orEmpty()
    if (existing.isNotEmpty() && existing != "Android Node") return existing

    val candidate = DeviceNames.bestDefaultNodeName(context).trim()
    val resolved = candidate.ifEmpty { "Android Node" }

    prefs.edit { putString(displayNameKey, resolved) }
    return resolved
  }

  fun setWakeWords(words: List<String>) {
    val sanitized = WakeWords.sanitize(words, defaultWakeWords)
    val encoded =
      JsonArray(sanitized.map { JsonPrimitive(it) }).toString()
    prefs.edit { putString("voiceWake.triggerWords", encoded) }
    _wakeWords.value = sanitized
  }

  fun setVoiceWakeMode(mode: VoiceWakeMode) {
    prefs.edit { putString(voiceWakeModeKey, mode.rawValue) }
    _voiceWakeMode.value = mode
  }

  fun setTalkEnabled(value: Boolean) {
    prefs.edit { putBoolean("talk.enabled", value) }
    _talkEnabled.value = value
  }

  private fun loadVoiceWakeMode(): VoiceWakeMode {
    val raw = prefs.getString(voiceWakeModeKey, null)
    val resolved = VoiceWakeMode.fromRawValue(raw)

    // Default ON (foreground) when unset.
    if (raw.isNullOrBlank()) {
      prefs.edit { putString(voiceWakeModeKey, resolved.rawValue) }
    }

    return resolved
  }

  private fun loadWakeWords(): List<String> {
    val raw = prefs.getString("voiceWake.triggerWords", null)?.trim()
    if (raw.isNullOrEmpty()) return defaultWakeWords
    return try {
      val element = json.parseToJsonElement(raw)
      val array = element as? JsonArray ?: return defaultWakeWords
      val decoded =
        array.mapNotNull { item ->
          when (item) {
            is JsonNull -> null
            is JsonPrimitive -> item.content.trim().takeIf { it.isNotEmpty() }
            else -> null
          }
        }
      WakeWords.sanitize(decoded, defaultWakeWords)
    } catch (_: Throwable) {
      defaultWakeWords
    }
  }
}
