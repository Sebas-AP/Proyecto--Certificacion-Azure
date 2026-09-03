# Especificación del Sistema de Gestión para una Cadena de Restaurantes de Gorditas

> Documento de contexto, requisitos y guía de implementación para GitHub Copilot.
>
> **Nombre provisional del proyecto:** GorditasOS  
> **Versión del documento:** 1.0  
> **Estado:** Especificación inicial  
> **Tipo de empresa:** Cadena mediana de restaurantes y puestos de gorditas tradicionales

---

## 1. Instrucciones para GitHub Copilot

Utiliza este documento como fuente principal de requisitos para diseñar e implementar el sistema.

Antes de generar código:

1. Analiza todos los módulos, actores, reglas de negocio y dependencias descritos.
2. Propón una arquitectura modular, mantenible y segura.
3. Divide la implementación en iteraciones pequeñas y verificables.
4. No construyas todos los módulos al mismo tiempo.
5. Implementa primero el núcleo de pedidos, sucursales, usuarios, productos, mesas y pagos.
6. Mantén separadas la lógica de negocio, la interfaz, la persistencia y las integraciones externas.
7. No codifiques nombres, precios, sucursales, impuestos, horarios ni permisos directamente en el código.
8. Toda característica variable debe ser configurable desde el panel administrativo o mediante variables de entorno.
9. Genera migraciones, datos de prueba, pruebas automatizadas y documentación para cada módulo.
10. No elimines físicamente pedidos, pagos, movimientos de inventario ni registros de auditoría.
11. Usa transacciones de base de datos para operaciones críticas.
12. Implementa control de acceso basado en roles y permisos.
13. Diseña la aplicación para funcionar con varias sucursales desde el inicio.
14. Mantén una bitácora de acciones sensibles.
15. Cuando un requisito sea ambiguo, documenta el supuesto utilizado antes de implementarlo.
16. No utilices IA para tomar decisiones financieras, disciplinarias o de inventario sin revisión humana.
17. Las integraciones de pago, mensajería y mapas deben abstraerse mediante interfaces o adaptadores.
18. La interfaz debe estar en español y preparada para internacionalización.
19. Las fechas deben almacenarse en UTC y mostrarse según la zona horaria configurada por sucursal.
20. Todos los importes monetarios deben usar tipos decimales, nunca punto flotante.

### Forma esperada de trabajo

Para cada fase:

1. Presentar el objetivo técnico.
2. Enumerar archivos o componentes que se crearán o modificarán.
3. Diseñar el esquema de datos necesario.
4. Implementar el backend.
5. Implementar la interfaz.
6. Crear pruebas unitarias y de integración.
7. Ejecutar validaciones de seguridad y calidad.
8. Actualizar la documentación.
9. Entregar instrucciones para ejecutar y probar la fase.

---

## 2. Resumen ejecutivo

La empresa administra varios restaurantes o puestos pertenecientes a una misma cadena de gorditas tradicionales. Actualmente, el establecimiento principal registra algunos pedidos en una tabla de Excel, mientras que las demás sucursales utilizan papel y libretas.

Esta forma de operación provoca información fragmentada, captura inconsistente, escasa trazabilidad, dificultad para consolidar ventas, poca visibilidad del inventario y ausencia de información en tiempo real.

El objetivo es construir una plataforma central, modular y personalizable que permita administrar:

- Sucursales.
- Usuarios, roles y turnos.
- Catálogo de productos.
- Mesas y órdenes.
- Pedidos de mostrador, para llevar y a domicilio.
- Aplicación para meseros.
- Pantalla de cocina.
- Caja y pagos.
- Inventario, recetas y compras.
- Gastos.
- Pedidos mediante mensajería.
- Reportes operativos y ejecutivos.
- Exportaciones a Excel.
- Funciones futuras de inteligencia artificial.

La estrategia de evolución será:

```text
Digitalizar -> Estandarizar -> Centralizar -> Medir -> Automatizar -> Predecir
```

---

## 3. Principios del producto

1. **Fuente única de información:** Todos los canales deben registrar sus operaciones en la misma base de datos.
2. **Diseño multisucursal:** Cada registro operativo debe pertenecer a una sucursal, salvo los catálogos corporativos.
3. **Configuración antes que código:** Menús, precios, permisos, horarios y reglas deben poder configurarse.
4. **Trazabilidad:** Cada operación crítica debe indicar quién, cuándo, dónde y por qué la realizó.
5. **Simplicidad operativa:** Las pantallas utilizadas durante horas pico deben requerir pocos pasos.
6. **Operación resiliente:** Debe existir un procedimiento ante pérdida de internet o dispositivos.
7. **Seguridad por diseño:** Aplicar autenticación, autorización, validación, cifrado y auditoría.
8. **IA asistiva:** La IA recomendará, clasificará o interpretará; una persona conservará el control.
9. **Portabilidad:** Los datos deben poder exportarse sin depender permanentemente de un proveedor.
10. **Evolución incremental:** El producto debe poder desplegarse por módulos y sucursales.

---

## 4. Objetivos del sistema

### 4.1 Objetivos de negocio

- Registrar digitalmente al menos el 95% de los pedidos.
- Consolidar las ventas de todas las sucursales.
- Reducir errores de captura y preparación.
- Conocer ventas, gastos y desempeño por sucursal.
- Controlar inventarios, compras, recetas y desperdicio.
- Reducir el tiempo requerido para cierres de caja.
- Habilitar pedidos por mensajería y a domicilio.
- Crear una base de datos confiable para analítica e IA.

### 4.2 Objetivos técnicos

- Crear una aplicación web responsiva y multisucursal.
- Proporcionar una API documentada y segura.
- Implementar una base de datos relacional central.
- Aplicar control de acceso basado en roles.
- Mantener auditoría de operaciones sensibles.
- Permitir exportaciones en CSV y XLSX.
- Separar integraciones externas mediante adaptadores.
- Incorporar observabilidad, respaldos y recuperación.
- Automatizar pruebas y despliegues.

### 4.3 Fuera del alcance inicial

- Contabilidad fiscal completa.
- Nómina.
- Facturación electrónica, salvo que se agregue como integración posterior.
- Optimización automática de rutas a gran escala.
- Decisiones disciplinarias automatizadas.
- Reconocimiento facial.
- Sustitución total del personal de atención.
- Modelos predictivos antes de contar con datos suficientes.

---

## 5. Actores y roles

### 5.1 Propietario o administrador general

- Consultar todas las sucursales.
- Configurar catálogos corporativos.
- Autorizar descuentos, cancelaciones y ajustes sensibles.
- Consultar reportes consolidados.
- Administrar usuarios y permisos.
- Revisar auditoría.

### 5.2 Gerente de sucursal

- Consultar y administrar su sucursal.
- Abrir y cerrar turnos.
- Autorizar operaciones según sus permisos.
- Revisar caja, pedidos, inventario y desempeño.
- Registrar incidencias.

### 5.3 Cajero

- Crear pedidos de mostrador.
- Cobrar órdenes.
- Registrar métodos de pago.
- Consultar su turno.
- Solicitar cancelaciones o devoluciones.
- Realizar corte de caja según autorización.

### 5.4 Mesero

- Abrir mesas.
- Capturar órdenes.
- Agregar modificadores y notas.
- Enviar comandas a cocina.
- Dividir o unir cuentas según permisos.
- Consultar el estado del pedido.

### 5.5 Personal de cocina

- Ver comandas pendientes.
- Cambiar los estados de preparación.
- Reportar productos agotados.
- Consultar notas y modificadores.

### 5.6 Repartidor

- Consultar pedidos asignados.
- Cambiar el estado de entrega.
- Registrar incidencias.
- Confirmar la entrega.

### 5.7 Responsable de inventario

- Registrar compras y recepciones.
- Realizar conteos.
- Registrar mermas y ajustes.
- Consultar existencias y movimientos.

### 5.8 Cliente

- Consultar menú y disponibilidad.
- Crear pedidos digitales.
- Confirmar datos y forma de entrega.
- Consultar estado.
- Recibir comprobantes y notificaciones.

---

## 6. Arquitectura funcional

```text
Canales de entrada
├── Punto de venta de mostrador
├── Aplicación de meseros
├── Sistema de mesas
├── Pedido telefónico
├── Mensajería
├── Aplicación web del cliente
└── Plataformas externas futuras
          │
          ▼
API y servicios de aplicación
├── Autenticación y autorización
├── Sucursales y configuración
├── Catálogo y precios
├── Pedidos y mesas
├── Cocina
├── Caja y pagos
├── Entregas
├── Inventario y recetas
├── Compras y gastos
├── Reportes
├── Notificaciones
└── Auditoría
          │
          ▼
Base de datos central
          │
          ▼
Analítica y automatización
├── Dashboard operativo
├── Dashboard ejecutivo
├── Exportaciones
├── Alertas
├── Pronóstico de ventas
├── Sugerencias de compra
└── Detección de anomalías
```

---

## 7. Arquitectura técnica sugerida

La solución debe permitir sustituir tecnologías sin reescribir la lógica de negocio. La siguiente pila es una recomendación, no una restricción absoluta.

### 7.1 Frontend

- Aplicación web responsiva.
- PWA para meseros y operación móvil.
- Interfaz en español.
- Componentes reutilizables.
- Manejo de sesiones y permisos.
- Cola local para acciones temporales sin conexión.
- Diseño optimizado para pantallas táctiles.

### 7.2 Backend

- API REST modular.
- Documentación OpenAPI.
- Servicios de dominio separados.
- Validación de solicitudes.
- Manejo centralizado de errores.
- Procesamiento asíncrono para notificaciones, exportaciones e integraciones.
- Idempotencia para pedidos, pagos y sincronización.

### 7.3 Persistencia

- Base de datos relacional, preferentemente PostgreSQL.
- Migraciones versionadas.
- Restricciones, índices y claves foráneas.
- Campos de auditoría.
- Eliminación lógica cuando corresponda.
- Almacenamiento de archivos separado de la base de datos.

### 7.4 Infraestructura

- Contenedores para desarrollo y despliegue.
- Ambientes separados: desarrollo, pruebas y producción.
- Variables de entorno y gestor de secretos.
- HTTPS obligatorio.
- Copias de seguridad automáticas.
- Registros centralizados.
- Monitoreo de disponibilidad y errores.
- Pipeline de integración y despliegue continuo.

### 7.5 Estructura sugerida del repositorio

```text
/
├── apps/
│   ├── admin-web/
│   ├── pos-web/
│   ├── waiter-pwa/
│   ├── kitchen-display/
│   └── api/
├── packages/
│   ├── ui/
│   ├── domain/
│   ├── validation/
│   ├── database/
│   ├── auth/
│   ├── reporting/
│   └── integrations/
├── infrastructure/
│   ├── containers/
│   ├── migrations/
│   └── deployment/
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── operations/
│   └── decisions/
├── tests/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
├── .env.example
├── compose.yaml
├── CONTRIBUTING.md
└── README.md
```

---

## 8. Personalización de la empresa

El sistema no debe asumir un nombre comercial específico. Crear una sección administrativa denominada **Identidad y configuración de la empresa**.

### Datos configurables

- Nombre comercial.
- Razón social opcional.
- Logotipo.
- Colores de marca.
- Teléfonos.
- Correo.
- Mensaje de bienvenida.
- Moneda.
- Zona horaria predeterminada.
- Formato de fecha y hora.
- Texto del comprobante.
- Políticas de cancelación.
- Métodos de pago aceptados.
- Horarios generales.
- Tiempos objetivo de preparación.
- Unidades de medida.

### Configuración por sucursal

- Nombre.
- Dirección.
- Coordenadas.
- Teléfono.
- Zona horaria.
- Horarios.
- Área o radio de entrega.
- Costo de entrega.
- Impresoras o estaciones de cocina.
- Mesas.
- Productos disponibles.
- Precios específicos, si están autorizados.
- Métodos de pago.
- Capacidad operativa.

### Variables de entorno mínimas

```dotenv
APP_NAME=GorditasOS
APP_ENV=development
APP_URL=http://localhost:3000
API_URL=http://localhost:4000
DATABASE_URL=
REDIS_URL=
SESSION_SECRET=
ENCRYPTION_KEY=
DEFAULT_TIMEZONE=America/Mexico_City
DEFAULT_CURRENCY=MXN
STORAGE_PROVIDER=local
STORAGE_BUCKET=
MESSAGING_PROVIDER=disabled
PAYMENT_PROVIDER=disabled
MAPS_PROVIDER=disabled
```

No incluir secretos reales en el repositorio.

---

## 9. Módulos funcionales

## 9.1 Autenticación, usuarios y permisos

### Requisitos

- Inicio de sesión seguro.
- PIN rápido para terminales operativas, asociado a un usuario individual.
- Contraseñas robustas para administración.
- Segundo factor opcional para propietarios y administradores.
- Recuperación segura de acceso.
- Roles configurables.
- Permisos granulares.
- Cierre de sesión automático por inactividad.
- Revocación de sesiones.
- Bloqueo temporal ante intentos repetidos.

### Permisos de ejemplo

```text
branch.read
branch.manage
product.read
product.manage
price.manage
order.create
order.update
order.cancel.request
order.cancel.approve
payment.create
payment.refund.request
payment.refund.approve
cash.open
cash.close
inventory.read
inventory.adjust
purchase.create
report.branch.read
report.company.read
user.manage
audit.read
```

---

## 9.2 Sucursales y turnos

### Funciones

- Alta y edición de sucursales.
- Activación o desactivación.
- Configuración de horarios.
- Apertura y cierre de turno.
- Asignación de empleados.
- Registro de fondo inicial.
- Resumen de actividad del turno.
- Registro de incidencias.

### Reglas

- No se puede operar caja sin turno abierto, salvo permiso especial.
- Una persona no debe tener dos turnos incompatibles abiertos.
- El cierre debe registrar efectivo esperado, efectivo contado y diferencia.
- Toda diferencia debe requerir observación.

---

## 9.3 Catálogo de productos

### Entidades

- Categoría.
- Producto.
- Variante.
- Modificador.
- Grupo de modificadores.
- Lista de precios.
- Disponibilidad por sucursal.
- Imagen opcional.

### Características

- Productos simples y configurables.
- Modificadores obligatorios u opcionales.
- Límites mínimos y máximos de selección.
- Precio adicional por modificador.
- Activación temporal.
- Productos agotados por sucursal.
- Historial de precios.
- Etiquetas para cocina.

### Ejemplo de producto

```yaml
name: Gordita de deshebrada
category: Gorditas
base_price: 35.00
preparation_station: Cocina caliente
modifier_groups:
  - name: Tipo de cocción
    required: true
    min: 1
    max: 1
    options:
      - Comal
      - Frita
  - name: Extras
    required: false
    min: 0
    max: 4
    options:
      - Queso
      - Crema
      - Salsa extra
  - name: Observaciones comunes
    required: false
    options:
      - Sin cebolla
      - Poco picante
      - Para llevar
```

---

## 9.4 Mesas y órdenes

### Estados de mesa

```text
DISPONIBLE
OCUPADA
CUENTA_SOLICITADA
RESERVADA
FUERA_DE_SERVICIO
```

### Estados de pedido

```text
BORRADOR
CONFIRMADO
EN_PREPARACION
LISTO
EN_ENTREGA
COMPLETADO
CANCELADO
RECHAZADO
```

### Tipos de pedido

```text
MESA
MOSTRADOR
PARA_LLEVAR
TELEFONO
MENSAJERIA
DOMICILIO_PROPIO
PLATAFORMA_EXTERNA
```

### Funciones

- Abrir mesa.
- Crear orden.
- Agregar productos y modificadores.
- Añadir notas.
- Enviar comanda.
- Incorporar productos posteriormente.
- Mover una cuenta.
- Unir o dividir cuentas.
- Dividir por producto, monto o persona.
- Solicitar cuenta.
- Cobrar con uno o varios métodos.
- Registrar propina separada cuando proceda.
- Cancelar con autorización.
- Imprimir o enviar comprobante.

### Reglas críticas

- Cada orden debe tener un folio único legible y un UUID interno.
- El precio del producto debe copiarse al detalle del pedido para conservar el valor histórico.
- Un cambio posterior de precio no debe modificar pedidos anteriores.
- Un pedido confirmado no debe eliminarse.
- Una cancelación debe conservar los productos, importes, usuario, fecha y motivo.
- Los productos enviados a cocina requieren un registro de evento.
- Reintentar una solicitud no debe duplicar el pedido.
- Una orden completada no puede modificarse, salvo mediante un flujo de corrección autorizado.

---

## 9.5 Aplicación para meseros

### Requisitos de experiencia

- Interfaz táctil.
- Carga rápida.
- Botones grandes.
- Búsqueda de productos.
- Favoritos o productos frecuentes.
- Estado visible de las mesas.
- Confirmación antes de acciones irreversibles.
- Indicador de conexión.
- Cola de sincronización.

### Flujo principal

```text
Iniciar sesión
-> Seleccionar turno
-> Ver mapa de mesas
-> Abrir o seleccionar mesa
-> Agregar productos
-> Elegir modificadores
-> Revisar orden
-> Enviar a cocina
-> Consultar estado
-> Solicitar o dividir cuenta
-> Enviar a caja
```

### Operación sin conexión

- Permitir capturar pedidos durante una interrupción breve.
- Asignar identificadores locales únicos.
- Mostrar claramente qué acciones no están sincronizadas.
- Sincronizar al recuperar conexión.
- Detectar conflictos y pedidos duplicados.
- No permitir pagos remotos sin validación del proveedor.

---

## 9.6 Pantalla de cocina

### Funciones

- Mostrar nuevas comandas en tiempo real.
- Ordenar por antigüedad y prioridad.
- Agrupar por estación.
- Mostrar modificadores y notas claramente.
- Marcar pedido como aceptado, en preparación y listo.
- Alertar pedidos cercanos al tiempo límite.
- Emitir sonido configurable.
- Recuperar pedidos después de reinicio.
- Mostrar historial reciente.

### Temporizadores

La interfaz debe usar tiempos objetivo configurables:

```text
VERDE: dentro del objetivo
AMARILLO: próximo al límite
ROJO: retrasado
```

Los colores no deben ser el único medio de comunicar el estado.

---

## 9.7 Caja y pagos

### Funciones

- Apertura de caja.
- Fondo inicial.
- Cobro de órdenes.
- Pagos mixtos.
- Efectivo, tarjeta, transferencia y otros métodos configurables.
- Cálculo de cambio.
- Registro de propinas.
- Retiros y entradas justificadas.
- Reembolsos autorizados.
- Corte parcial y final.
- Arqueo.
- Diferencias de caja.

### Reglas

- El sistema no debe almacenar datos completos de tarjetas.
- Los pagos externos deben usar identificadores o tokens del proveedor.
- Las operaciones deben ser idempotentes.
- Un reembolso necesita referencia al pago original.
- Los movimientos manuales de caja requieren motivo.
- No se debe alterar un corte cerrado.

---

## 9.8 Pedidos a domicilio

### Estados

```text
NUEVO
CONFIRMADO
EN_PREPARACION
LISTO
ASIGNADO
EN_CAMINO
ENTREGADO
CANCELADO
NO_LOCALIZADO
REQUIERE_ACLARACION
```

### Panel de despacho

Mostrar:

- Folio.
- Hora de recepción.
- Tiempo transcurrido.
- Sucursal.
- Cliente.
- Teléfono parcialmente oculto según rol.
- Dirección y referencias.
- Importe.
- Método y estado de pago.
- Estado del pedido.
- Repartidor.
- Tiempo estimado.
- Alertas y observaciones.

### Funciones

- Asignar repartidor.
- Cambiar estado.
- Registrar intento de contacto.
- Confirmar entrega.
- Registrar incidencia.
- Consultar historial.
- Agrupar visualmente por zona.
- Calcular indicadores de tiempo.

---

## 9.9 Mensajería y toma de pedidos

La mensajería debe implementarse mediante un proveedor oficial y un adaptador desacoplado.

### Primera versión: flujo estructurado

```text
1. Hacer un pedido
2. Consultar menú
3. Consultar estado
4. Ver horarios y sucursales
5. Hablar con una persona
```

### Flujo de pedido

1. Determinar sucursal.
2. Elegir recolección o entrega.
3. Mostrar catálogo disponible.
4. Seleccionar producto, variantes y modificadores.
5. Capturar cantidad.
6. Capturar o seleccionar dirección.
7. Calcular entrega.
8. Seleccionar forma de pago.
9. Mostrar resumen.
10. Solicitar confirmación explícita.
11. Crear el pedido de manera idempotente.
12. Enviar folio y estado.

### Escalamiento humano

Transferir a una persona cuando:

- La intención no sea clara.
- El producto solicitado no exista.
- Existan instrucciones contradictorias.
- El cliente solicite una excepción.
- Haya una reclamación.
- El pago no pueda verificarse.
- La confianza de interpretación sea inferior al umbral.

### IA futura para mensajes libres

La IA podrá convertir texto en una propuesta estructurada, pero nunca enviar directamente a cocina sin confirmación del cliente o revisión humana cuando exista ambigüedad.

Ejemplo:

```json
{
  "channel": "messaging",
  "serviceType": "delivery",
  "items": [
    {
      "product": "gordita",
      "variant": "chicharron",
      "quantity": 2,
      "modifiers": ["sin cebolla"]
    },
    {
      "product": "gordita",
      "variant": "deshebrada",
      "quantity": 3,
      "modifiers": []
    }
  ],
  "requiresConfirmation": true
}
```

---

## 9.10 Inventario y recetas

### Entidades

- Ingrediente.
- Unidad de medida.
- Conversión.
- Almacén.
- Existencia.
- Movimiento.
- Receta.
- Componente de receta.
- Merma.
- Conteo físico.
- Transferencia.

### Tipos de movimiento

```text
COMPRA
CONSUMO_TEORICO
MERMA
AJUSTE_POSITIVO
AJUSTE_NEGATIVO
TRANSFERENCIA_ENTRADA
TRANSFERENCIA_SALIDA
DEVOLUCION_PROVEEDOR
CONTEO
```

### Reglas

- Todo movimiento debe ser inmutable y trazable.
- Los ajustes requieren motivo y permisos.
- Las transferencias deben tener salida y entrada relacionadas.
- Las recetas deben conservar versiones.
- La venta debe generar consumo teórico según la receta vigente.
- Las unidades deben admitir conversiones, por ejemplo kilogramo a gramo.
- Los inventarios negativos deben ser bloqueados o alertados según configuración.

### Fórmulas

```text
Consumo teórico = cantidad vendida × cantidad por receta

Diferencia de consumo = consumo real - consumo teórico

Punto de reposición = consumo diario promedio × días de entrega + inventario de seguridad

Compra sugerida = demanda esperada + inventario de seguridad - existencia disponible - compras pendientes
```

---

## 9.11 Compras y proveedores

### Funciones

- Catálogo de proveedores.
- Solicitud de compra.
- Orden de compra.
- Recepción total o parcial.
- Registro de costo.
- Diferencias entre pedido y recepción.
- Historial de precios.
- Documentos adjuntos.
- Devoluciones.
- Compras por sucursal o corporativas.

### Reglas

- La recepción de una compra debe generar movimientos de inventario.
- Una recepción parcial no debe cerrar automáticamente la orden.
- Los costos históricos no deben sobrescribirse.
- Las compras canceladas deben conservarse en auditoría.

---

## 9.12 Gastos

### Categorías iniciales

- Renta.
- Gas.
- Electricidad.
- Agua.
- Nómina resumida.
- Transporte.
- Mantenimiento.
- Comisiones.
- Publicidad.
- Empaques.
- Limpieza.
- Otros.

### Funciones

- Registrar gasto.
- Asociar sucursal.
- Asociar proveedor.
- Adjuntar comprobante.
- Definir recurrencia.
- Marcar estado de pago.
- Autorizar gastos sensibles.
- Consultar por periodo y categoría.

---

## 9.13 Reportes y dashboard

### Dashboard operativo

- Pedidos abiertos.
- Pedidos retrasados.
- Mesas activas.
- Ventas del turno.
- Productos agotados.
- Diferencias de caja.
- Entregas en curso.
- Alertas operativas.

### Dashboard ejecutivo

- Ventas brutas y netas.
- Ventas por sucursal.
- Ventas por canal.
- Ventas por hora y día.
- Número de pedidos.
- Ticket promedio.
- Productos más vendidos.
- Descuentos.
- Cancelaciones.
- Métodos de pago.
- Gastos.
- Costo teórico de ingredientes.
- Margen estimado.
- Inventario y desperdicio.

### Fórmulas base

```text
Ticket promedio = ventas netas / pedidos pagados

Productos por pedido = unidades vendidas / pedidos pagados

Tasa de cancelación = pedidos cancelados / pedidos creados × 100

Costo de alimentos = costo teórico de ingredientes / ventas netas × 100

Desperdicio = valor de merma / valor total de ingredientes utilizados × 100
```

### Exportaciones

- CSV.
- XLSX.
- Filtros por fechas, sucursal, canal, usuario y producto.
- Exportaciones asíncronas para grandes volúmenes.
- Registro de quién generó cada exportación.

---

## 9.14 Auditoría

Registrar al menos:

- Inicio y cierre de sesión.
- Cambios de permisos.
- Cambios de precios.
- Apertura y cierre de caja.
- Cancelaciones.
- Reembolsos.
- Descuentos.
- Ajustes de inventario.
- Cambios de recetas.
- Exportaciones de información.
- Cambios de configuración.

Cada evento debe incluir:

```text
actor_id
branch_id
entity_type
entity_id
action
previous_values
new_values
reason
ip_address
device_id
created_at
correlation_id
```

Los datos sensibles deben enmascararse en la auditoría.

---

## 10. Modelo de datos inicial

### Entidades centrales

```text
companies
company_settings
branches
branch_settings
users
roles
permissions
user_roles
role_permissions
shifts
cash_registers
cash_sessions
cash_movements
categories
products
product_variants
modifier_groups
modifiers
product_modifier_groups
price_lists
product_prices
branch_products
tables
orders
order_items
order_item_modifiers
order_events
payments
refunds
customers
customer_addresses
deliveries
drivers
ingredients
units
unit_conversions
recipes
recipe_versions
recipe_items
warehouses
stock_balances
stock_movements
stock_counts
waste_records
suppliers
purchase_orders
purchase_order_items
goods_receipts
expenses
notifications
message_conversations
message_events
audit_logs
integration_events
```

### Campos comunes recomendados

```text
id: UUID
company_id: UUID cuando corresponda
branch_id: UUID cuando corresponda
created_at: timestamp UTC
updated_at: timestamp UTC
created_by: UUID opcional
updated_by: UUID opcional
status: valor controlado
version: número para control de concurrencia cuando corresponda
```

### Restricciones importantes

- Correos normalizados y únicos dentro del alcance definido.
- Folios únicos por sucursal y tipo de documento.
- Cantidades y precios no negativos, excepto movimientos explícitos.
- Estados controlados mediante enumeraciones o catálogos.
- Claves foráneas obligatorias.
- Índices por sucursal, fecha, estado y folio.
- Índices para búsquedas frecuentes de pedidos y productos.
- Restricción de unicidad para claves de idempotencia.

---

## 11. Reglas de negocio transversales

1. Un usuario solo puede operar sucursales autorizadas.
2. Los permisos corporativos y de sucursal deben distinguirse.
3. Todos los pedidos deben indicar canal.
4. Los pedidos confirmados no se eliminan.
5. Los pagos no se eliminan ni modifican directamente.
6. Los reembolsos se registran como nuevas operaciones.
7. Los precios históricos se preservan en cada detalle de pedido.
8. El cambio de una receta solo se aplica desde su fecha de vigencia.
9. Una sucursal puede ocultar temporalmente productos agotados.
10. Los descuentos superiores a un límite requieren aprobación.
11. Las cancelaciones requieren motivo.
12. Un usuario no puede aprobar su propia operación cuando la separación de funciones esté activada.
13. Los reportes deben respetar la zona horaria de la sucursal.
14. Las métricas consolidadas deben normalizar moneda y zona horaria.
15. Las operaciones críticas deben utilizar transacciones.
16. Las solicitudes reintentadas deben ser idempotentes.
17. Las integraciones deben procesar eventos repetidos sin duplicar resultados.

---

## 12. API inicial sugerida

### Autenticación

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/pin-login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
```

### Sucursales

```text
GET    /api/v1/branches
POST   /api/v1/branches
GET    /api/v1/branches/:id
PATCH  /api/v1/branches/:id
GET    /api/v1/branches/:id/settings
PATCH  /api/v1/branches/:id/settings
```

### Productos

```text
GET    /api/v1/products
POST   /api/v1/products
GET    /api/v1/products/:id
PATCH  /api/v1/products/:id
GET    /api/v1/branches/:branchId/menu
PATCH  /api/v1/branches/:branchId/products/:productId/availability
```

### Pedidos

```text
GET    /api/v1/orders
POST   /api/v1/orders
GET    /api/v1/orders/:id
PATCH  /api/v1/orders/:id
POST   /api/v1/orders/:id/items
PATCH  /api/v1/orders/:id/items/:itemId
POST   /api/v1/orders/:id/confirm
POST   /api/v1/orders/:id/send-to-kitchen
POST   /api/v1/orders/:id/cancel-request
POST   /api/v1/orders/:id/cancel-approve
GET    /api/v1/orders/:id/events
```

### Cocina

```text
GET    /api/v1/kitchen/tickets
POST   /api/v1/kitchen/tickets/:id/accept
POST   /api/v1/kitchen/tickets/:id/start
POST   /api/v1/kitchen/tickets/:id/complete
```

### Pagos y caja

```text
POST   /api/v1/cash-sessions/open
POST   /api/v1/cash-sessions/:id/movements
POST   /api/v1/cash-sessions/:id/close
POST   /api/v1/orders/:id/payments
POST   /api/v1/payments/:id/refund-request
POST   /api/v1/payments/:id/refund-approve
```

### Inventario

```text
GET    /api/v1/inventory/balances
GET    /api/v1/inventory/movements
POST   /api/v1/inventory/adjustments
POST   /api/v1/inventory/transfers
POST   /api/v1/inventory/counts
POST   /api/v1/inventory/waste
```

### Reportes

```text
GET    /api/v1/reports/sales-summary
GET    /api/v1/reports/products
GET    /api/v1/reports/channels
GET    /api/v1/reports/cash-differences
GET    /api/v1/reports/inventory-variance
POST   /api/v1/exports
GET    /api/v1/exports/:id
```

Cada endpoint debe validar autenticación, autorización, pertenencia a sucursal, esquema de entrada y límites de paginación.

---

## 13. Historias de usuario prioritarias

### HU-001: Crear pedido de mostrador

**Como** cajero,  
**quiero** crear un pedido de mostrador,  
**para** enviar la orden a cocina y cobrarla.

#### Criterios de aceptación

- Se selecciona la sucursal activa automáticamente.
- Es posible agregar productos y modificadores.
- Se muestra subtotal y total.
- Al confirmar se asigna folio.
- Cocina recibe la comanda.
- Reintentar la confirmación no duplica el pedido.

### HU-002: Abrir una mesa

**Como** mesero,  
**quiero** abrir una mesa disponible,  
**para** registrar el consumo de los clientes.

#### Criterios de aceptación

- Solo se muestran mesas de la sucursal.
- Una mesa ocupada no puede abrirse como una nueva cuenta sin advertencia.
- Se registra mesero, hora y turno.
- La mesa cambia a estado ocupada.

### HU-003: Enviar orden a cocina

**Como** mesero,  
**quiero** enviar nuevos productos a cocina,  
**para** iniciar su preparación.

#### Criterios de aceptación

- Solo se envían artículos no enviados previamente.
- Se preservan modificadores y notas.
- Se registra fecha y usuario.
- La pantalla de cocina recibe la comanda.
- Un reintento no genera una comanda duplicada.

### HU-004: Cobrar una orden

**Como** cajero,  
**quiero** registrar uno o varios pagos,  
**para** liquidar una orden.

#### Criterios de aceptación

- La suma de pagos debe cubrir correctamente el total.
- Se permite pago mixto.
- El efectivo calcula cambio.
- La orden cambia a pagada cuando corresponde.
- Se genera comprobante.
- El pago queda asociado a la sesión de caja.

### HU-005: Cancelar una orden

**Como** empleado autorizado,  
**quiero** cancelar una orden indicando el motivo,  
**para** corregir un pedido sin eliminar su historial.

#### Criterios de aceptación

- Se valida el permiso.
- El motivo es obligatorio.
- Se conserva la orden original.
- Se registra un evento de auditoría.
- Si existe pago, el sistema conduce al flujo de reembolso.

### HU-006: Consultar ventas consolidadas

**Como** propietario,  
**quiero** consultar ventas por sucursal y periodo,  
**para** comparar el desempeño de la cadena.

#### Criterios de aceptación

- Se filtra por fecha, sucursal y canal.
- Se muestran ventas netas, pedidos y ticket promedio.
- Los totales coinciden con los pedidos pagados.
- Se puede exportar el resultado.

### HU-007: Registrar una merma

**Como** responsable de inventario,  
**quiero** registrar una merma con motivo,  
**para** mantener existencias confiables.

#### Criterios de aceptación

- Se seleccionan ingrediente, cantidad, unidad y almacén.
- El motivo es obligatorio.
- La conversión de unidad es correcta.
- Se genera movimiento de inventario.
- La operación queda auditada.

### HU-008: Recibir pedido por mensajería

**Como** encargado de pedidos,  
**quiero** que un pedido confirmado por el cliente llegue al sistema central,  
**para** evitar recapturarlo.

#### Criterios de aceptación

- El pedido contiene canal y conversación de origen.
- Los productos se validan contra el menú de la sucursal.
- El cliente confirma el resumen.
- La integración utiliza una clave de idempotencia.
- El pedido aparece en el dashboard correspondiente.

---

## 14. Requisitos no funcionales

### Rendimiento

- Las acciones comunes deben responder rápidamente en condiciones normales.
- Paginar todas las listas grandes.
- Evitar consultas N+1.
- Aplicar caché solo cuando no comprometa consistencia.
- La pantalla de cocina debe actualizarse en tiempo casi real.

### Disponibilidad

- Definir objetivos de disponibilidad según el presupuesto.
- Contar con monitoreo y alertas.
- Implementar respaldos automáticos.
- Probar periódicamente la restauración.

### Escalabilidad

- Soportar nuevas sucursales sin modificar el esquema central.
- Separar procesos pesados mediante colas.
- Permitir réplicas y servicios independientes en fases futuras.

### Accesibilidad

- Navegación por teclado en administración.
- Etiquetas para lectores de pantalla.
- Contraste adecuado.
- No depender exclusivamente de color.
- Tamaño táctil apropiado.

### Compatibilidad

- Navegadores modernos.
- Tabletas Android de gama media.
- Computadoras de escritorio.
- Impresoras térmicas mediante adaptador cuando sea necesario.

---

## 15. Seguridad y privacidad

### Controles mínimos

- HTTPS.
- Contraseñas con hash seguro.
- Tokens y sesiones con expiración.
- Protección contra fuerza bruta.
- Validación estricta de entradas.
- Consultas parametrizadas u ORM seguro.
- Protección CSRF cuando aplique.
- Política CORS restrictiva.
- Encabezados de seguridad.
- Control de acceso a nivel de objeto y función.
- Rate limiting.
- Registro de incidentes.
- Cifrado de secretos.
- Dependencias actualizadas.
- Análisis de vulnerabilidades en CI.

### Privacidad

- Recopilar únicamente datos necesarios.
- Limitar acceso a teléfonos y direcciones.
- Aplicar enmascaramiento en pantallas y registros.
- Definir periodos de conservación.
- Permitir corrección o eliminación de datos personales cuando corresponda legalmente, sin destruir registros financieros obligatorios.
- No utilizar datos de clientes para promoción sin consentimiento aplicable.

### Reglas para IA

- Documentar propósito, datos y limitaciones de cada modelo.
- Medir errores.
- Mantener revisión humana.
- Permitir desactivar una función de IA.
- Registrar versión del modelo y recomendación emitida.
- No entrenar con datos personales sin una base válida y controles apropiados.
- No presentar predicciones como hechos garantizados.

---

## 16. Observabilidad y soporte

### Registros

- Estructurados en formato JSON.
- Con identificador de correlación.
- Sin contraseñas, tokens ni datos completos de pago.
- Con niveles debug, info, warning y error.

### Métricas técnicas

- Latencia por endpoint.
- Tasa de errores.
- Solicitudes por minuto.
- Trabajos pendientes.
- Fallas de integración.
- Conexiones de base de datos.
- Sincronizaciones pendientes.

### Métricas operativas

- Pedidos creados.
- Pedidos cancelados.
- Tiempo de preparación.
- Pedidos atrasados.
- Diferencias de caja.
- Productos agotados.

---

## 17. Estrategia de pruebas

### Pruebas unitarias

- Cálculo de totales.
- Descuentos.
- Cambio.
- Estados de pedido.
- Conversión de unidades.
- Consumo teórico.
- Punto de reposición.
- Permisos.

### Pruebas de integración

- Creación completa de pedido.
- Envío a cocina.
- Cobro.
- Cancelación y reembolso.
- Recepción de compra.
- Ajuste de inventario.
- Webhooks de mensajería.
- Idempotencia.

### Pruebas de extremo a extremo

```text
Mesero abre mesa
-> captura orden
-> cocina prepara
-> cajero cobra
-> mesa se libera
-> venta aparece en reporte
-> inventario registra consumo teórico
```

### Pruebas de seguridad

- Acceso a sucursal no autorizada.
- Lectura de pedidos de otro usuario o sucursal.
- Escalamiento de privilegios.
- Repetición de webhooks.
- Inyección.
- Fuerza bruta.
- Exportaciones sin autorización.

### Datos de prueba

Crear semillas con:

- Una empresa de demostración.
- Tres sucursales.
- Usuarios por rol.
- Mesas.
- Categorías y productos ficticios.
- Modificadores.
- Ingredientes y recetas.
- Proveedores.
- Pedidos en distintos estados.

No utilizar información real de clientes.

---

## 18. Plan de implementación

## Fase 0: Preparación

**Duración estimada:** 1 semana.

### Entregables

- Repositorio.
- Convenciones de código.
- Arquitectura inicial.
- Ambientes.
- CI básico.
- Registro de decisiones técnicas.
- Backlog inicial.

## Fase 1: Núcleo de identidad y sucursales

**Duración estimada:** 2 semanas.

### Alcance

- Empresa y configuración.
- Sucursales.
- Usuarios.
- Roles y permisos.
- Autenticación.
- Turnos básicos.
- Auditoría inicial.

### Definición de terminado

- Migraciones aplicables desde cero.
- Usuarios de prueba.
- Restricción multisucursal probada.
- API documentada.
- Pruebas automatizadas.

## Fase 2: Catálogo, mesas y pedidos

**Duración estimada:** 3 semanas.

### Alcance

- Categorías.
- Productos.
- Variantes.
- Modificadores.
- Precios.
- Disponibilidad.
- Mesas.
- Pedidos.
- Detalles y eventos.

## Fase 3: Aplicación para meseros y cocina

**Duración estimada:** 3 semanas.

### Alcance

- PWA para meseros.
- Mapa de mesas.
- Captura táctil.
- Envío de comanda.
- Pantalla de cocina.
- Estados y temporizadores.
- Actualización en tiempo real.

## Fase 4: Caja y pagos

**Duración estimada:** 2 a 3 semanas.

### Alcance

- Sesión de caja.
- Fondo inicial.
- Pagos.
- Pagos mixtos.
- Movimientos.
- Cierre y diferencias.
- Cancelaciones y reembolsos.

## Fase 5: Piloto

**Duración estimada:** 4 semanas.

### Actividades

- Carga del menú real.
- Configuración de una sucursal.
- Pruebas de hora pico.
- Capacitación.
- Operación paralela temporal.
- Registro de incidencias.
- Ajustes de experiencia.
- Validación del cierre diario.

### Criterios de salida

- No se pierden pedidos.
- No se duplican comandas.
- Caja coincide con operaciones registradas.
- Los usuarios ejecutan sus flujos principales.
- Existe contingencia ante pérdida de internet.

## Fase 6: Reportes y despliegue multisucursal

**Duración estimada:** 3 semanas más despliegue gradual.

### Alcance

- Dashboard operativo.
- Dashboard ejecutivo inicial.
- Exportaciones.
- Despliegue por sucursal.
- Capacitación por rol.

## Fase 7: Inventario, recetas y compras

**Duración estimada:** 4 a 6 semanas.

### Alcance

- Ingredientes.
- Unidades.
- Recetas versionadas.
- Inventario.
- Compras.
- Conteos.
- Mermas.
- Transferencias.
- Costos teóricos.

## Fase 8: Domicilio y mensajería

**Duración estimada:** 4 a 6 semanas.

### Alcance

- Panel de reparto.
- Repartidores.
- Entregas.
- Adaptador de mensajería.
- Menú interactivo.
- Pedido estructurado.
- Confirmación.
- Escalamiento humano.

## Fase 9: Analítica e IA

**Inicio recomendado:** Después de 3 a 6 meses de datos consistentes.

### Alcance gradual

1. Pronóstico de ventas.
2. Pronóstico de ingredientes.
3. Sugerencia de compra.
4. Riesgo de agotamiento.
5. Detección de anomalías.
6. Interpretación de pedidos libres.
7. Clasificación de comentarios.

---

## 19. Casos de uso de inteligencia artificial

### 19.1 Pronóstico de ventas

Predecir unidades por sucursal, producto, día y franja horaria usando:

- Historial.
- Día de la semana.
- Hora.
- Temporada.
- Quincena.
- Promociones.
- Días festivos.
- Disponibilidad.
- Variables externas autorizadas.

Comparar siempre contra una línea base sencilla:

```text
Promedio de las últimas cuatro semanas para el mismo día y horario
```

El modelo solo debe adoptarse si mejora la referencia de forma consistente.

### 19.2 Sugerencias de compra

Generar una recomendación editable con:

- Demanda esperada.
- Existencia actual.
- Inventario de seguridad.
- Pedidos pendientes.
- Tiempo de entrega del proveedor.
- Excedentes en otras sucursales.

Una persona debe aprobar la orden.

### 19.3 Detección de anomalías

Alertar sobre:

- Cancelaciones inusuales.
- Descuentos elevados.
- Diferencias recurrentes de caja.
- Consumo que no corresponde a ventas.
- Caídas atípicas de ventas.
- Ajustes frecuentes de inventario.

Las alertas no constituyen acusaciones y requieren revisión humana.

### 19.4 Interpretación de pedidos

Convertir mensajes libres en un pedido propuesto y solicitar confirmación.

Medir:

- Exactitud por producto.
- Exactitud de cantidades.
- Exactitud de modificadores.
- Tasa de intervención humana.
- Tasa de abandono.
- Pedidos corregidos antes de confirmar.

---

## 20. Indicadores de éxito

### Operación

- Porcentaje de pedidos digitales.
- Tiempo de captura.
- Tiempo de preparación.
- Pedidos con error.
- Tasa de cancelación.
- Productos agotados.
- Tiempo de cierre.

### Finanzas

- Ventas por sucursal.
- Ticket promedio.
- Margen estimado.
- Costo de alimentos.
- Descuentos.
- Diferencias de caja.
- Valor de merma.

### Inventario

- Exactitud del inventario.
- Diferencia real contra teórica.
- Rotación.
- Días de inventario.
- Compras urgentes.
- Transferencias entre sucursales.

### Tecnología

- Disponibilidad.
- Latencia.
- Incidentes.
- Errores de sincronización.
- Tiempo de resolución.
- Fallas de integraciones.

### IA

- Error de pronóstico.
- Reducción de desperdicio.
- Recomendaciones aceptadas.
- Falsas alertas.
- Pedidos interpretados correctamente.

---

## 21. Definición global de terminado

Una funcionalidad se considera terminada cuando:

- Cumple sus criterios de aceptación.
- Respeta permisos y aislamiento multisucursal.
- Incluye migraciones.
- Incluye pruebas unitarias e integración.
- No introduce errores críticos de seguridad.
- Tiene documentación técnica.
- Tiene instrucciones de uso cuando aplica.
- Registra auditoría cuando corresponde.
- Maneja errores de forma comprensible.
- Funciona en dispositivos objetivo.
- Ha sido validada con datos de prueba.
- No expone secretos ni datos sensibles en registros.

---

## 22. Primer prompt recomendado para GitHub Copilot

Usa el siguiente prompt después de agregar este archivo al repositorio:

```text
Lee completamente el archivo ESPECIFICACION_SISTEMA_GORDITAS.md y úsalo como fuente de requisitos.

No intentes construir todo el sistema en una sola respuesta. Primero realiza estas tareas:

1. Resume la arquitectura y las dependencias entre módulos.
2. Propón una pila tecnológica concreta y justifica cada elección.
3. Crea un plan de trabajo por iteraciones, comenzando con la Fase 0 y la Fase 1.
4. Propón la estructura final del repositorio.
5. Define el modelo inicial de base de datos para empresa, configuración, sucursales, usuarios, roles, permisos, turnos y auditoría.
6. Enumera las decisiones que requieren una política explícita de la empresa.
7. Identifica riesgos técnicos, de seguridad y de operación.
8. No generes todavía los módulos de pedidos, inventario, mensajería o IA.

Después, implementa únicamente el esqueleto del proyecto y la Fase 1. Incluye migraciones, datos de prueba, API documentada, pruebas automatizadas, archivo .env.example, contenedores de desarrollo y README con instrucciones reproducibles.

Mantén todos los nombres comerciales, logotipos, colores, sucursales, horarios, precios y métodos de pago como datos configurables. La interfaz debe estar en español. No incluyas secretos reales ni datos personales reales.
```

---

## 23. Preguntas que la empresa debe resolver

Antes o durante el piloto deben documentarse estas decisiones:

1. Nombre comercial y elementos de marca.
2. Número y ubicación de sucursales.
3. Menú real, precios y modificadores.
4. Diferencias de menú por sucursal.
5. Métodos de pago.
6. Política de descuentos.
7. Política de cancelaciones y devoluciones.
8. Roles y autorizaciones.
9. Forma actual de corte de caja.
10. Impresoras y dispositivos disponibles.
11. Calidad del internet en cada local.
12. Flujo de cocina y estaciones.
13. Zonas y costos de entrega.
14. Uso de repartidores propios o externos.
15. Recetas, porciones y unidades.
16. Proveedores y tiempos de entrega.
17. Frecuencia de inventarios físicos.
18. Reportes necesarios para el propietario.
19. Política de privacidad y conservación de datos.
20. Presupuesto para infraestructura, licencias y soporte.

Estas preguntas no bloquean la creación del esqueleto técnico, pero sí deben resolverse antes de configurar la operación real.

---

## 24. Resultado esperado

Al completar las fases operativas, la empresa debe contar con una plataforma capaz de seguir el flujo completo:

```text
Cliente
-> Pedido
-> Preparación
-> Entrega
-> Pago
-> Consumo de inventario
-> Cierre de caja
-> Reporte
-> Análisis y recomendación
```

El sistema debe ser específico para la operación de una cadena de gorditas, pero suficientemente configurable para cambiar productos, recetas, sucursales, precios, permisos, canales y reglas sin reescribir el núcleo.
