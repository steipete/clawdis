package com.steipete.clawdis.node.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.steipete.clawdis.node.BuildConfig
import com.steipete.clawdis.node.MainViewModel
import com.steipete.clawdis.node.NodeForegroundService
import com.steipete.clawdis.node.VoiceWakeMode

@Composable
fun SettingsSheet(viewModel: MainViewModel) {
  val context = LocalContext.current
  val instanceId by viewModel.instanceId.collectAsState()
  val displayName by viewModel.displayName.collectAsState()
  val cameraEnabled by viewModel.cameraEnabled.collectAsState()
  val preventSleep by viewModel.preventSleep.collectAsState()
  val wakeWords by viewModel.wakeWords.collectAsState()
  val voiceWakeMode by viewModel.voiceWakeMode.collectAsState()
  val voiceWakeStatusText by viewModel.voiceWakeStatusText.collectAsState()
  val isConnected by viewModel.isConnected.collectAsState()
  val manualEnabled by viewModel.manualEnabled.collectAsState()
  val manualHost by viewModel.manualHost.collectAsState()
  val manualPort by viewModel.manualPort.collectAsState()
  val canvasDebugStatusEnabled by viewModel.canvasDebugStatusEnabled.collectAsState()
  val statusText by viewModel.statusText.collectAsState()
  val serverName by viewModel.serverName.collectAsState()
  val remoteAddress by viewModel.remoteAddress.collectAsState()
  val bridges by viewModel.bridges.collectAsState()
  val discoveryStatusText by viewModel.discoveryStatusText.collectAsState()

  val listState = rememberLazyListState()
  val (wakeWordsText, setWakeWordsText) = remember { mutableStateOf("") }
  val (advancedExpanded, setAdvancedExpanded) = remember { mutableStateOf(false) }
  val deviceModel =
    remember {
      listOfNotNull(Build.MANUFACTURER, Build.MODEL)
        .joinToString(" ")
        .trim()
        .ifEmpty { "Android" }
    }
  val appVersion =
    remember {
      val versionName = BuildConfig.VERSION_NAME.trim().ifEmpty { "dev" }
      if (BuildConfig.DEBUG && !versionName.contains("dev", ignoreCase = true)) {
        "$versionName-dev"
      } else {
        versionName
      }
    }

  LaunchedEffect(wakeWords) { setWakeWordsText(wakeWords.joinToString(", ")) }

  val permissionLauncher =
    rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { perms ->
      val cameraOk = perms[Manifest.permission.CAMERA] == true
      viewModel.setCameraEnabled(cameraOk)
    }

  val audioPermissionLauncher =
    rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { _ ->
      // Status text is handled by NodeRuntime.
    }

  fun setCameraEnabledChecked(checked: Boolean) {
    if (!checked) {
      viewModel.setCameraEnabled(false)
      return
    }

    val cameraOk =
      ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
        PackageManager.PERMISSION_GRANTED
    if (cameraOk) {
      viewModel.setCameraEnabled(true)
    } else {
      permissionLauncher.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO))
    }
  }

  val visibleBridges =
    if (isConnected && remoteAddress != null) {
      bridges.filterNot { "${it.host}:${it.port}" == remoteAddress }
    } else {
      bridges
    }

  val bridgeDiscoveryFooterText =
    if (visibleBridges.isEmpty()) {
      discoveryStatusText
    } else if (isConnected) {
      "Discovery active • ${visibleBridges.size} other bridge${if (visibleBridges.size == 1) "" else "s"} found"
    } else {
      "Discovery active • ${visibleBridges.size} bridge${if (visibleBridges.size == 1) "" else "s"} found"
    }

  LazyColumn(
    state = listState,
    modifier =
      Modifier
        .fillMaxWidth()
        .fillMaxHeight()
        .imePadding()
        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom)),
    contentPadding = PaddingValues(16.dp),
    verticalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    // Order parity: Node → Bridge → Voice → Camera → Screen.
    item { Text("Node", style = MaterialTheme.typography.titleSmall) }
    item {
      OutlinedTextField(
        value = displayName,
        onValueChange = viewModel::setDisplayName,
        label = { Text("Name") },
        modifier = Modifier.fillMaxWidth(),
      )
    }
    item { Text("Instance ID: $instanceId", color = MaterialTheme.colorScheme.onSurfaceVariant) }
    item { Text("Device: $deviceModel", color = MaterialTheme.colorScheme.onSurfaceVariant) }
    item { Text("Version: $appVersion", color = MaterialTheme.colorScheme.onSurfaceVariant) }

    item { HorizontalDivider() }

    // Bridge
    item { Text("Bridge", style = MaterialTheme.typography.titleSmall) }
    item { ListItem(headlineContent = { Text("Status") }, supportingContent = { Text(statusText) }) }
    if (serverName != null) {
      item { ListItem(headlineContent = { Text("Server") }, supportingContent = { Text(serverName!!) }) }
    }
    if (remoteAddress != null) {
      item { ListItem(headlineContent = { Text("Address") }, supportingContent = { Text(remoteAddress!!) }) }
    }
    item {
      // UI sanity: "Disconnect" only when we have an active remote.
      if (isConnected && remoteAddress != null) {
        Button(
          onClick = {
            viewModel.disconnect()
            NodeForegroundService.stop(context)
          },
        ) {
          Text("Disconnect")
        }
      }
    }

    item { HorizontalDivider() }

    if (!isConnected || visibleBridges.isNotEmpty()) {
      item {
        Text(
          if (isConnected) "Other Bridges" else "Discovered Bridges",
          style = MaterialTheme.typography.titleSmall,
        )
      }
      if (!isConnected && visibleBridges.isEmpty()) {
        item { Text("No bridges found yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
      } else {
        items(items = visibleBridges, key = { it.stableId }) { bridge ->
          val detailLines =
            buildList {
              add("IP: ${bridge.host}:${bridge.port}")
              bridge.lanHost?.let { add("LAN: $it") }
              bridge.tailnetDns?.let { add("Tailnet: $it") }
              if (bridge.gatewayPort != null || bridge.bridgePort != null || bridge.canvasPort != null) {
                val gw = bridge.gatewayPort?.toString() ?: "—"
                val br = (bridge.bridgePort ?: bridge.port).toString()
                val canvas = bridge.canvasPort?.toString() ?: "—"
                add("Ports: gw $gw · bridge $br · canvas $canvas")
              }
            }
          ListItem(
            headlineContent = { Text(bridge.name) },
            supportingContent = {
              Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                detailLines.forEach { line ->
                  Text(line, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
              }
            },
            trailingContent = {
              Button(
                onClick = {
                  NodeForegroundService.start(context)
                  viewModel.connect(bridge)
                },
              ) {
                Text("Connect")
              }
            },
          )
        }
      }
      item {
        Text(
          bridgeDiscoveryFooterText,
          modifier = Modifier.fillMaxWidth(),
          textAlign = TextAlign.Center,
          style = MaterialTheme.typography.labelMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }

    item { HorizontalDivider() }

    item {
      ListItem(
        headlineContent = { Text("Advanced") },
        supportingContent = { Text("Manual bridge connection") },
        trailingContent = {
          Icon(
            imageVector = if (advancedExpanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
            contentDescription = if (advancedExpanded) "Collapse" else "Expand",
          )
        },
        modifier =
          Modifier.clickable {
            setAdvancedExpanded(!advancedExpanded)
          },
      )
    }
    item {
      AnimatedVisibility(visible = advancedExpanded) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
          ListItem(
            headlineContent = { Text("Use Manual Bridge") },
            supportingContent = { Text("Use this when discovery is blocked.") },
            trailingContent = { Switch(checked = manualEnabled, onCheckedChange = viewModel::setManualEnabled) },
          )

          OutlinedTextField(
            value = manualHost,
            onValueChange = viewModel::setManualHost,
            label = { Text("Host") },
            modifier = Modifier.fillMaxWidth(),
            enabled = manualEnabled,
          )
          OutlinedTextField(
            value = manualPort.toString(),
            onValueChange = { v -> viewModel.setManualPort(v.toIntOrNull() ?: 0) },
            label = { Text("Port") },
            modifier = Modifier.fillMaxWidth(),
            enabled = manualEnabled,
          )

          val hostOk = manualHost.trim().isNotEmpty()
          val portOk = manualPort in 1..65535
          Button(
            onClick = {
              NodeForegroundService.start(context)
              viewModel.connectManual()
            },
            enabled = manualEnabled && hostOk && portOk,
          ) {
            Text("Connect (Manual)")
          }
        }
      }
    }

    item { HorizontalDivider() }

    // Voice
    item { Text("Voice", style = MaterialTheme.typography.titleSmall) }
    item {
      val enabled = voiceWakeMode != VoiceWakeMode.Off
      ListItem(
        headlineContent = { Text("Voice Wake") },
        supportingContent = { Text(voiceWakeStatusText) },
        trailingContent = {
          Switch(
            checked = enabled,
            onCheckedChange = { on ->
              if (on) {
                val micOk =
                  ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                    PackageManager.PERMISSION_GRANTED
                if (!micOk) audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                viewModel.setVoiceWakeMode(VoiceWakeMode.Foreground)
              } else {
                viewModel.setVoiceWakeMode(VoiceWakeMode.Off)
              }
            },
          )
        },
      )
    }
    item {
      AnimatedVisibility(visible = voiceWakeMode != VoiceWakeMode.Off) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
          ListItem(
            headlineContent = { Text("Foreground Only") },
            supportingContent = { Text("Listens only while Clawdis is open.") },
            trailingContent = {
              RadioButton(
                selected = voiceWakeMode == VoiceWakeMode.Foreground,
                onClick = {
                  val micOk =
                    ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                      PackageManager.PERMISSION_GRANTED
                  if (!micOk) audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                  viewModel.setVoiceWakeMode(VoiceWakeMode.Foreground)
                },
              )
            },
          )
          ListItem(
            headlineContent = { Text("Always") },
            supportingContent = { Text("Keeps listening in the background (shows a persistent notification).") },
            trailingContent = {
              RadioButton(
                selected = voiceWakeMode == VoiceWakeMode.Always,
                onClick = {
                  val micOk =
                    ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                      PackageManager.PERMISSION_GRANTED
                  if (!micOk) audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                  viewModel.setVoiceWakeMode(VoiceWakeMode.Always)
                },
              )
            },
          )
        }
      }
    }
    item {
      OutlinedTextField(
        value = wakeWordsText,
        onValueChange = setWakeWordsText,
        label = { Text("Wake Words (comma-separated)") },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
      )
    }
    item {
      Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Button(
          onClick = {
            val parsed = com.steipete.clawdis.node.WakeWords.parseCommaSeparated(wakeWordsText)
            viewModel.setWakeWords(parsed)
          },
          enabled = isConnected,
        ) {
          Text("Save + Sync")
        }

        Button(onClick = viewModel::resetWakeWordsDefaults) { Text("Reset defaults") }
      }
    }
    item {
      Text(
        if (isConnected) {
          "Any node can edit wake words. Changes sync via the gateway bridge."
        } else {
          "Connect to a gateway to sync wake words globally."
        },
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }

    item { HorizontalDivider() }

    // Camera
    item { Text("Camera", style = MaterialTheme.typography.titleSmall) }
    item {
      ListItem(
        headlineContent = { Text("Allow Camera") },
        supportingContent = { Text("Allows the bridge to request photos or short video clips (foreground only).") },
        trailingContent = { Switch(checked = cameraEnabled, onCheckedChange = ::setCameraEnabledChecked) },
      )
    }
    item {
      Text(
        "Tip: grant Microphone permission for video clips with audio.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }

    item { HorizontalDivider() }

    // Screen
    item { Text("Screen", style = MaterialTheme.typography.titleSmall) }
    item {
      ListItem(
        headlineContent = { Text("Prevent Sleep") },
        supportingContent = { Text("Keeps the screen awake while Clawdis is open.") },
        trailingContent = { Switch(checked = preventSleep, onCheckedChange = viewModel::setPreventSleep) },
      )
    }

    item { HorizontalDivider() }

    // Debug
    item { Text("Debug", style = MaterialTheme.typography.titleSmall) }
    item {
      ListItem(
        headlineContent = { Text("Debug Canvas Status") },
        supportingContent = { Text("Show status text in the canvas when debug is enabled.") },
        trailingContent = {
          Switch(
            checked = canvasDebugStatusEnabled,
            onCheckedChange = viewModel::setCanvasDebugStatusEnabled,
          )
        },
      )
    }

    item { Spacer(modifier = Modifier.height(20.dp)) }
  }
}
