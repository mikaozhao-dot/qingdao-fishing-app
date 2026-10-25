import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qingdao_fishing_app/step4_flow.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('departure submits only passengers with effective coverage', (
    tester,
  ) async {
    List<String>? submittedPassengerIds;
    const eligiblePassengerId = 'passenger-effective';
    const blockedPassengerId = 'passenger-failed';
    final gate = {
      'canDepartureProceed': true,
      'requiredCoverage': {'status': 'effective'},
      'passengers': [
        {
          'passengerId': eligiblePassengerId,
          'seatNumber': 1,
          'status': 'effective',
          'canBoard': true,
        },
        {
          'passengerId': blockedPassengerId,
          'seatNumber': 2,
          'status': 'failed',
          'failureReason': 'insurer_rejected',
          'canBoard': false,
        },
      ],
    };

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                builder: (sheetContext) => Step4InsuranceGateSheet(
                  gate: gate,
                  onDepart: (ids) => submittedPassengerIds = ids,
                ),
              ),
              child: const Text('open gate'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('open gate'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('保障未生效的乘客不能登船；其他保障已生效的乘客可继续出航。'),
      120,
    );
    await tester.pumpAndSettle();
    expect(find.text('保障未生效的乘客不能登船；其他保障已生效的乘客可继续出航。'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('确认 1 位可登船乘客出航'), 120);
    await tester.pumpAndSettle();
    expect(find.widgetWithText(FilledButton, '确认 1 位可登船乘客出航'), findsOneWidget);
    await tester.tap(find.text('确认 1 位可登船乘客出航'));
    await tester.pumpAndSettle();
    expect(submittedPassengerIds, [eligiblePassengerId, blockedPassengerId]);
  });
}
