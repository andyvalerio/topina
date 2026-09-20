/// Topina Alerts — a receiver, nothing more.
///
/// The monitoring service decides what is worth knowing about; this app exists
/// only to make sure the phone actually buzzes when it does. It shows the FCM
/// token so it can be copied into the service's configuration, and keeps a
/// short log of what has arrived so a missed notification can be checked
/// against what was actually sent.
///
/// There is no communication back to the service. For one phone and one cat,
/// pasting a token once is simpler and more robust than device registration,
/// discovery, and a server reachable from the handset.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:url_launcher/url_launcher.dart';

/// Declared here and in AndroidManifest so FCM routes background messages to
/// it. Importance.max is what produces a heads-up notification that can be
/// seen without unlocking — the entire point of this app.
const alertChannel = AndroidNotificationChannel(
  'topina_alerts',
  'Topina alerts',
  description: 'Distress signals while she is out',
  importance: Importance.max,
);

final localNotifications = FlutterLocalNotificationsPlugin();

/// Background handler must be a top-level function: the isolate that runs it
/// when the app is terminated has none of the app's state.
@pragma('vm:entry-point')
Future<void> _onBackgroundMessage(RemoteMessage message) async {
  await Firebase.initializeApp();
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();

  FirebaseMessaging.onBackgroundMessage(_onBackgroundMessage);

  await localNotifications
      .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
      ?.createNotificationChannel(alertChannel);

  runApp(const TopinaApp());
}

class TopinaApp extends StatelessWidget {
  const TopinaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Topina Alerts',
      theme: ThemeData.dark(useMaterial3: true),
      home: const HomePage(),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  String? _token;
  String _permission = 'checking…';
  final List<RemoteMessage> _received = [];

  @override
  void initState() {
    super.initState();
    _setUp();
  }

  /// Tapping an alert should land on a map, and Tractive already have one.
  /// Their app claims every path on applink.tractive.com but only routes the
  /// root, so deeper links open it showing an error.
  Future<void> _openFrom(RemoteMessage message) async {
    final url = message.data['url'];
    if (url == null) return;
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  Future<void> _setUp() async {
    final settings = await FirebaseMessaging.instance.requestPermission();
    final token = await FirebaseMessaging.instance.getToken();

    // A notification arriving while the app is open does not raise a system
    // notification by itself, so show one — otherwise having the app in front
    // of you would be the one case where you miss the alert.
    FirebaseMessaging.onMessage.listen((message) {
      final notification = message.notification;
      if (notification != null) {
        localNotifications.show(
          id: notification.hashCode,
          title: notification.title,
          body: notification.body,
          notificationDetails: NotificationDetails(
            android: AndroidNotificationDetails(
              alertChannel.id,
              alertChannel.name,
              channelDescription: alertChannel.description,
              importance: Importance.max,
              priority: Priority.high,
            ),
          ),
        );
      }
      setState(() => _received.insert(0, message));
    });

    // Tapped while the app was in the background.
    FirebaseMessaging.onMessageOpenedApp.listen(_openFrom);

    // Tapped while the app was not running at all: the message that started
    // it is waiting here rather than arriving on the stream.
    final launchedBy = await FirebaseMessaging.instance.getInitialMessage();
    if (launchedBy != null) await _openFrom(launchedBy);

    FirebaseMessaging.instance.onTokenRefresh.listen((fresh) {
      setState(() => _token = fresh);
    });

    setState(() {
      _token = token;
      _permission = settings.authorizationStatus.name;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Topina Alerts')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Notifications: $_permission',
              style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 16),
          Text('Device token', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 4),
          const Text(
            'Paste this into the service as FCM_TOKEN.',
            style: TextStyle(fontSize: 12, color: Colors.white54),
          ),
          const SizedBox(height: 8),
          SelectableText(
            _token ?? 'waiting for a token…',
            style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
          ),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: _token == null
                ? null
                : () {
                    Clipboard.setData(ClipboardData(text: _token!));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Token copied')),
                    );
                  },
            icon: const Icon(Icons.copy),
            label: const Text('Copy token'),
          ),
          const Divider(height: 40),
          Text('Received while open (${_received.length})',
              style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          if (_received.isEmpty)
            const Text('Nothing yet.',
                style: TextStyle(color: Colors.white54, fontSize: 13)),
          for (final message in _received)
            Card(
              child: ListTile(
                title: Text(message.notification?.title ?? '(no title)'),
                subtitle: Text(message.notification?.body ?? ''),
              ),
            ),
        ],
      ),
    );
  }
}
