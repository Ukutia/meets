from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from .models import Periodo


class PeriodosTests(APITestCase):
    def setUp(self):
        self.client.force_authenticate(User.objects.create_user('u', password='x'))

    def test_nuevo_periodo_cierra_el_vigente(self):
        self.client.post('/api/periodos/', {'nombre': 'Antes', 'fecha_inicio': '2026-01-01'}, format='json')
        r = self.client.post('/api/periodos/', {'nombre': 'Formal', 'fecha_inicio': '2026-11-01'}, format='json')
        self.assertEqual(r.status_code, 201)
        antes = Periodo.objects.get(nombre='Antes')
        self.assertEqual(str(antes.fecha_fin), '2026-10-31')
        self.assertIsNone(Periodo.objects.get(nombre='Formal').fecha_fin)

    def test_rechaza_inicio_anterior_al_vigente(self):
        self.client.post('/api/periodos/', {'nombre': 'A', 'fecha_inicio': '2026-05-01'}, format='json')
        r = self.client.post('/api/periodos/', {'nombre': 'B', 'fecha_inicio': '2026-04-01'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_borrar_vigente_reabre_el_anterior(self):
        self.client.post('/api/periodos/', {'nombre': 'A', 'fecha_inicio': '2026-01-01'}, format='json')
        r = self.client.post('/api/periodos/', {'nombre': 'B', 'fecha_inicio': '2026-06-01'}, format='json')
        self.client.delete(f"/api/periodos/{r.json()['id']}/")
        self.assertIsNone(Periodo.objects.get(nombre='A').fecha_fin)

    def crear_tres(self):
        return [self.client.post('/api/periodos/', {'nombre': nombre, 'fecha_inicio': inicio},
                                 format='json').json()['id']
                for nombre, inicio in [('A', '2026-01-01'), ('B', '2026-05-01'), ('C', '2026-09-01')]]

    def test_editar_inicio_ajusta_cierre_anterior(self):
        a, b, c = self.crear_tres()
        for inicio, fin in [('2026-06-01', '2026-05-31'), ('2026-03-01', '2026-02-28')]:
            r = self.client.patch(f'/api/periodos/{b}/', {'fecha_inicio': inicio}, format='json')
            self.assertEqual(r.status_code, 200)
            self.assertEqual(str(Periodo.objects.get(pk=a).fecha_fin), fin)
            self.assertEqual(r.json()['fecha_fin'], '2026-08-31')
            self.assertIsNone(Periodo.objects.get(pk=c).fecha_fin)

    def test_rechaza_cruzar_o_igualar_vecinos_sin_modificar_datos(self):
        a, b, c = self.crear_tres()
        for inicio in ['2025-12-31', '2026-01-01', '2026-09-01', '2026-10-01']:
            r = self.client.patch(f'/api/periodos/{b}/',
                                  {'nombre': 'No guardar', 'fecha_inicio': inicio}, format='json')
            self.assertEqual(r.status_code, 400)
            self.assertEqual(Periodo.objects.get(pk=b).nombre, 'B')
            self.assertEqual(str(Periodo.objects.get(pk=a).fecha_fin), '2026-04-30')

    def test_borrar_intermedio_extiende_anterior(self):
        a, b, c = self.crear_tres()
        self.assertEqual(self.client.delete(f'/api/periodos/{b}/').status_code, 204)
        self.assertEqual(str(Periodo.objects.get(pk=a).fecha_fin), '2026-08-31')
        self.assertIsNone(Periodo.objects.get(pk=c).fecha_fin)

    def test_editar_vigente_ajusta_anterior_y_conserva_abierto(self):
        a, b, c = self.crear_tres()
        r = self.client.patch(f'/api/periodos/{c}/', {'fecha_inicio': '2026-10-01'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.json()['fecha_fin'])
        self.assertEqual(str(Periodo.objects.get(pk=b).fecha_fin), '2026-09-30')

    def test_editar_nombre_y_borrar_primer_y_ultimo_periodo(self):
        a, b, c = self.crear_tres()
        r = self.client.patch(f'/api/periodos/{a}/', {'nombre': 'Renombrado'}, format='json')
        self.assertEqual(r.json()['nombre'], 'Renombrado')
        for pk in [a, b, c]:
            self.assertEqual(self.client.delete(f'/api/periodos/{pk}/').status_code, 204)
        self.assertEqual(list(Periodo.objects.all()), [])

    def test_rechaza_datos_invalidos(self):
        a, b, c = self.crear_tres()
        for datos in [{'nombre': ''}, {'nombre': 123}, {'nombre': 'x' * 101}, {'fecha_inicio': 'incorrecta'}]:
            self.assertEqual(self.client.patch(f'/api/periodos/{b}/', datos, format='json').status_code, 400)

    def test_periodo_inexistente_y_autenticacion(self):
        self.assertEqual(self.client.patch('/api/periodos/999/', {}, format='json').status_code, 404)
        self.assertEqual(self.client.delete('/api/periodos/999/').status_code, 404)
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get('/api/periodos/').status_code, [401, 403])
