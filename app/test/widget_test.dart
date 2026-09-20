library;

/// The app is a receiver with almost no logic of its own, so this only guards
/// the one thing that would make it useless: the alert channel must be
/// max-importance, or notifications arrive silently in the drawer instead of
/// as a heads-up alert.
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:topina_alerts/main.dart';

void main() {
  test('alerts use a max-importance channel', () {
    expect(alertChannel.importance, Importance.max);
  });

  test('the channel id matches the one declared in AndroidManifest', () {
    // FCM routes background notifications by this id; a mismatch means
    // background alerts silently land on a default-importance channel.
    expect(alertChannel.id, 'topina_alerts');
  });
}
