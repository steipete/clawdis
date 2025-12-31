// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "ClawdisKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v15),
    ],
    products: [
        .library(name: "ClawdisKit", targets: ["ClawdisKit"]),
        .library(name: "ClawdisChatUI", targets: ["ClawdisChatUI"]),
    ],
    dependencies: [
        .package(path: "../../../../ElevenLabsKit"),
    ],
    targets: [
        .target(
            name: "ClawdisKit",
            dependencies: [
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "ClawdisChatUI",
            dependencies: ["ClawdisKit"],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "ClawdisKitTests",
            dependencies: ["ClawdisKit", "ClawdisChatUI"],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
