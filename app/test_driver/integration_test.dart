import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  final outputDirectory = Directory('../design/step3-review-photos');
  await outputDirectory.create(recursive: true);
  await integrationDriver(
    onScreenshot: (name, bytes, [args]) async {
      await File('${outputDirectory.path}/$name.png').writeAsBytes(bytes);
      return true;
    },
  );
}
