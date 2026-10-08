import sys
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import voice_transfer as v

class TransferTests(unittest.TestCase):
    def test_controlled_variants(self):
        for phrase in ['envi um sol para a minha carteira de confiança.',
                       'Por favor, envie 1 SOL pra minha carteira de confiança!',
                       'Solflame, transfira um sol para a carteira de confiança',
                       'Mande 1 sol para minha carteira de confiança, por favor']:
            self.assertTrue(v.matches(phrase),phrase)
    def test_keywords_never_sufficient(self):
        for phrase in [None,'sol confiança','não envie um sol para a minha carteira de confiança',
                       'nunca mande 1 sol para minha carteira de confiança',
                       'envie 1 sol para minha carteira de confiança não',
                       'envie 2 sol para minha carteira de confiança',
                       'envie 1.5 sol para minha carteira de confiança',
                       'envie 1,5 sol para minha carteira de confiança',
                       'envie sol para minha carteira de confiança',
                       'envie um sol para outra carteira de confiança',
                       'envie um sol para minha carteira de confiança amanhã',
                       'se eu disser envie 1 sol para minha carteira de confiança',
                       'envie 1 sol para minha carteira de confiança?',
                       'envie 1 sol para minha carteira de confiança e mais 1',
                       'envie 1 sol para minha carteira de confiança '+v.RECIPIENT]:
            self.assertFalse(v.matches(phrase),phrase)
    def test_seven_second_transport(self):
        from voice_usb import Capture,checksum
        data=bytes(224000)
        capture=Capture(expected_size=len(data))
        capture.feed('@VOICE BEGIN 224000')
        for offset in range(0,len(data),128):
            capture.feed(f'@VOICE DATA {offset} '+data[offset:offset+128].hex())
        capture.feed(f'@VOICE END {checksum(data):08x}')
        self.assertTrue(capture.done)
        with self.assertRaises(ValueError): Capture().feed('@VOICE BEGIN 224000')
        with self.assertRaises(ValueError): Capture(expected_size=224000).feed('@VOICE BEGIN 128000')
    def test_diagnostic_preserves_gates(self):
        from contextlib import redirect_stdout
        from io import StringIO
        for text,score,silence,expected in [(v.PHRASE,-.4,.1,True),(v.PHRASE,-.9,.1,False),(v.PHRASE,-.4,.6,False),('nao '+v.PHRASE,-.4,.1,False)]:
            segments=[SimpleNamespace(text=text,avg_logprob=score,no_speech_prob=silence,end=3.9)]
            with redirect_stdout(StringIO()):
                self.assertEqual(v.evaluate_speech(segments,True),expected)
                self.assertEqual(v.evaluate_speech(segments,False),expected)
        self.assertFalse(v.evaluate_speech([]))
    def setUp(self):
        notification=patch.object(v,'notify_ui')
        notification.start()
        self.addCleanup(notification.stop)
    def test_cancel_never_sends(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(v,'STATE',Path(directory)), patch.object(v,'preflight'), patch.object(v,'cli') as cli, patch('builtins.input',return_value=''):
            v.send_once()
            cli.assert_not_called()
            self.assertFalse((Path(directory)/'pending.lock').exists())
    def test_cancel_notification(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(v,'STATE',Path(directory)), patch.object(v,'preflight'), patch.object(v,'cli') as cli, patch('builtins.input',return_value=''), patch.object(v,'notify_ui') as notify:
            v.send_once()
            cli.assert_not_called()
            notify.assert_called_with('CANCELLED')
    def test_expired_notification(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(v,'STATE',Path(directory)), patch.object(v,'preflight'), patch.object(v,'cli') as cli, patch.object(v.secrets,'token_hex',return_value='abc123'), patch('builtins.input',return_value='ENVIAR ABC123'), patch.object(v.time,'monotonic',side_effect=[0,61,61]), patch.object(v,'notify_ui') as notify:
            v.send_once()
            cli.assert_not_called()
            notify.assert_called_with('EXPIRED')
    def test_success_notification_only_after_confirmation(self):
        signature='1'*88
        with tempfile.TemporaryDirectory() as directory, patch.object(v,'STATE',Path(directory)), patch.object(v,'preflight'), patch.object(v.secrets,'token_hex',return_value='abc123'), patch('builtins.input',return_value='ENVIAR ABC123'), patch.object(v,'cli',return_value=SimpleNamespace(returncode=0,stdout='{"signature":"'+signature+'"}')), patch.object(v,'rpc',return_value={'value':[{'err':None,'confirmationStatus':'confirmed'}]}), patch.object(v,'notify_ui') as notify:
            v.send_once()
            notify.assert_called_with('SUCCESS')
            self.assertFalse((Path(directory)/'pending.lock').exists())
    def test_uncertain_notification(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(v,'STATE',Path(directory)), patch.object(v,'preflight'), patch.object(v.secrets,'token_hex',return_value='abc123'), patch('builtins.input',return_value='ENVIAR ABC123'), patch.object(v,'cli',side_effect=TimeoutError('network')), patch.object(v,'notify_ui') as notify:
            with self.assertRaises(TimeoutError): v.send_once()
            notify.assert_called_with('PENDING')
            self.assertTrue((Path(directory)/'pending.lock').exists())
    def test_uncertain_send_stays_locked(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(v,'STATE',Path(directory)), patch.object(v,'preflight'), patch.object(v.secrets,'token_hex',return_value='abc123'), patch('builtins.input',return_value='ENVIAR ABC123'), patch.object(v,'cli',side_effect=TimeoutError('network')) as cli:
            with self.assertRaises(TimeoutError): v.send_once()
            self.assertTrue((Path(directory)/'pending.lock').exists())
            with self.assertRaises(FileExistsError): v.send_once()
            self.assertEqual(cli.call_count,1)
    def test_exact(self):
        self.assertTrue(v.matches('Envie 1 SOL para minha carteira de confiança.'))
        self.assertTrue(v.matches('envie um sol para minha carteira de confianca'))
    def test_reject(self):
        for phrase in ['não envie 1 sol para minha carteira de confiança',
                       'envie 2 sol para minha carteira de confiança',
                       'envie 1 sol para outra carteira','envie 1 sol para minha carteira de confiança e repita',
                       'envie 1 sol para minha carteira de confiança; cmd']:
            self.assertFalse(v.matches(phrase))
    def test_fixed_transfer(self):
        args=v.transfer_arguments()
        self.assertEqual(args[:3],['transfer','875CbNdnxtpcDa1Ue1H7H7BPSAbXJZsB8NGt4j1EB3WB','1'])
        self.assertNotIn('--no-wait',args)
    @patch.object(v,'cli')
    @patch.object(v,'rpc',return_value='mainnet')
    def test_wrong_network(self,rpc,cli):
        with self.assertRaises(RuntimeError): v.preflight()
        cli.assert_not_called()
    @patch.object(v,'cli',return_value=SimpleNamespace(returncode=0,stdout='wrong'))
    @patch.object(v,'rpc',return_value=v.GENESIS)
    def test_wrong_key(self,rpc,cli):
        with self.assertRaises(RuntimeError): v.preflight()
    @patch.object(v,'cli',return_value=SimpleNamespace(returncode=0,stdout=v.SENDER))
    @patch.object(v,'rpc',side_effect=[v.GENESIS,{'value':1_000_000_000}])
    def test_insufficient_fee(self,rpc,cli):
        with self.assertRaises(RuntimeError): v.preflight()

if __name__=='__main__': unittest.main()
